// aios-usage.js

class AIOSUsage {
    constructor(elements = {}) {
        this.elements = elements;
    }

    formatNumber(value) {
        const numeric = Number(value) || 0;
        return numeric.toLocaleString();
    }

    setError(message = '') {
        if (!this.elements.usageError) return;
        this.elements.usageError.textContent = message || '';
    }

    setLoading() {
        if (this.elements.usageInputTokens) this.elements.usageInputTokens.textContent = '...';
        if (this.elements.usageOutputTokens) this.elements.usageOutputTokens.textContent = '...';
        if (this.elements.usageTotalTokens) this.elements.usageTotalTokens.textContent = '...';
        this.setError('');
    }

    setEmpty() {
        if (this.elements.usageInputTokens) this.elements.usageInputTokens.textContent = '-';
        if (this.elements.usageOutputTokens) this.elements.usageOutputTokens.textContent = '-';
        if (this.elements.usageTotalTokens) this.elements.usageTotalTokens.textContent = '-';
        this.setError('');
    }

    render(data = {}) {
        const input = Number(data.input_tokens) || 0;
        const output = Number(data.output_tokens) || 0;
        const total = Number(data.total_tokens) || (input + output);

        if (this.elements.usageInputTokens) this.elements.usageInputTokens.textContent = this.formatNumber(input);
        if (this.elements.usageOutputTokens) this.elements.usageOutputTokens.textContent = this.formatNumber(output);
        if (this.elements.usageTotalTokens) this.elements.usageTotalTokens.textContent = this.formatNumber(total);
        this.setError('');
    }
}

window.AIOSUsage = AIOSUsage;

