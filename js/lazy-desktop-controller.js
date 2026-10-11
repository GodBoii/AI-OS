// Owns command routing without loading native dependencies until first use.
function createLazyDesktopController({ factory, emitter, commandChannel, resultChannel, commandMethod = 'handleCommand', onCreate }) {
    let instance = null;
    let disposed = false;
    const get = () => {
        if (disposed) throw new Error('Desktop controller is shutting down');
        if (!instance) {
            const created = factory();
            onCreate?.(created);
            instance = created;
        }
        return instance;
    };
    const listener = async payload => {
        try {
            await get()[commandMethod](payload);
        } catch (error) {
            emitter.emit(resultChannel, { request_id: payload?.request_id, action: payload?.action,
                success: false, status: 'error', error: error.message });
        }
    };
    emitter.on(commandChannel, listener);
    return new Proxy({}, {
        get(_target, key) {
            if (key === 'peek') return () => instance;
            if (key === 'cleanup') return async () => {
                disposed = true;
                emitter.removeListener(commandChannel, listener);
                await instance?.cleanup?.();
                instance = null;
            };
            return (...args) => get()[key](...args);
        },
    });
}

module.exports = { createLazyDesktopController };
