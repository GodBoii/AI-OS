// Completed inactive views move to local IndexedDB; running views keep their live nodes.
export class ConversationViewCache {
    constructor({ threads, isPinned, serialize, hydrate, dispose, maxIdleViews = 2 }) {
        Object.assign(this, { threads, isPinned, serialize, hydrate, dispose, maxIdleViews });
        this.archived = new Set();
        this.generation = 0;
        this.pruning = null;
        this.databasePromise = null;
    }

    database() {
        if (!this.databasePromise) {
            this.databasePromise = new Promise((resolve, reject) => {
                const request = indexedDB.open('aetheria-conversation-views', 1);
                request.onupgradeneeded = () => request.result.createObjectStore('views');
                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    const db = request.result;
                    const transaction = db.transaction('views', 'readwrite');
                    transaction.objectStore('views').clear();
                    transaction.oncomplete = () => resolve(db);
                    transaction.onabort = () => { db.close(); reject(transaction.error); };
                };
            }).catch(error => { this.databasePromise = null; throw error; });
        }
        return this.databasePromise;
    }

    async storage(operation, id, value) {
        const db = await this.database();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('views', operation === 'get' ? 'readonly' : 'readwrite');
            const store = transaction.objectStore('views');
            const request = operation === 'put' ? store.put(value, id) : store[operation](id);
            transaction.oncomplete = () => resolve(request.result);
            transaction.onabort = () => reject(transaction.error || request.error);
            transaction.onerror = () => reject(transaction.error || request.error);
        });
    }

    async restore(id) {
        if (this.threads.has(id)) return this.threads.get(id);
        if (!this.archived.has(id)) return null;
        const generation = this.generation;
        const snapshot = await this.storage('get', id);
        if (generation !== this.generation || !snapshot) return null;
        const thread = this.hydrate(snapshot, id);
        this.threads.set(id, thread);
        this.archived.delete(id);
        await this.storage('delete', id);
        return thread;
    }

    prune(activeId) {
        this.activeId = activeId;
        if (this.pruning) return this.pruning;
        const generation = this.generation;
        this.pruning = (async () => {
            const idle = () => [...this.threads].filter(([id, thread]) => id !== this.activeId && !this.isPinned(id, thread));
            while (generation === this.generation && idle().length > this.maxIdleViews) {
                const [id, thread] = idle()[0];
                const snapshot = this.serialize(thread, id);
                await this.storage('put', id, snapshot);
                if (generation !== this.generation) { await this.storage('delete', id); return; }
                if (id === this.activeId || this.isPinned(id, thread) || this.threads.get(id) !== thread) continue;
                this.dispose(thread, id);
                thread.remove();
                this.threads.delete(id);
                this.archived.add(id);
            }
        })().catch(error => console.warn('[ConversationViews] Keeping live view after storage failure:', error.message))
            .finally(() => { this.pruning = null; });
        return this.pruning;
    }

    forget(id) {
        this.archived.delete(id);
        if (this.databasePromise) void this.storage('delete', id).catch(error => console.warn('[ConversationViews] Delete failed:', error.message));
    }

    async clear() {
        this.generation++;
        this.archived.clear();
        await this.pruning;
        if (this.databasePromise) await this.storage('clear');
    }
}
