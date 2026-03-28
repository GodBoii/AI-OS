// aios-usage-graph.js - Inline Daily Usage Graph Component

class AIOSUsageGraph {
    constructor(aiosInstance) {
        this.aios = aiosInstance;
        this.chart = null;
        this.currentPeriod = 7;
        this.dailyData = [];
        this.chartData = [];
        this.elements = {};
        this.isGraphView = false;
    }

    init() {
        this.cacheElements();
        this.setupEventListeners();
    }

    cacheElements() {
        this.elements = {
            toggleBtn: document.getElementById('usage-graph-toggle'),
            summaryView: document.getElementById('usage-summary-view'),
            graphView: document.getElementById('usage-graph-view'),
            periodBtns: document.querySelectorAll('.period-btn'),
            loading: document.getElementById('usage-graph-loading'),
            error: document.getElementById('usage-graph-error'),
            errorMessage: document.getElementById('usage-graph-error-message'),
            canvasContainer: document.getElementById('usage-graph-canvas-container'),
            canvas: document.getElementById('usage-graph-canvas'),
            statAvg: document.getElementById('usage-stat-avg'),
            statPeak: document.getElementById('usage-stat-peak'),
            statTotal: document.getElementById('usage-stat-total'),
        };
    }

    setupEventListeners() {
        if (this.elements.toggleBtn) {
            this.elements.toggleBtn.addEventListener('click', () => this.toggle());
        }

        this.elements.periodBtns?.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const period = parseInt(e.currentTarget.dataset.period, 10);
                if (!Number.isFinite(period) || period <= 0) return;
                this.changePeriod(period);
            });
        });
    }

    async toggle() {
        if (!this.aios.authService?.isAuthenticated?.()) {
            this.aios.showNotification('Please sign in to view usage analytics', 'error');
            return;
        }

        this.isGraphView = !this.isGraphView;

        if (this.isGraphView) {
            this.elements.summaryView?.classList.add('hidden');
            this.elements.graphView?.classList.remove('hidden');
            this.elements.toggleBtn?.classList.add('active');
            await this.loadData(this.currentPeriod);
        } else {
            this.elements.summaryView?.classList.remove('hidden');
            this.elements.graphView?.classList.add('hidden');
            this.elements.toggleBtn?.classList.remove('active');
        }
    }

    async changePeriod(period) {
        this.currentPeriod = period;

        this.elements.periodBtns?.forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.dataset.period, 10) === period);
        });

        await this.loadData(period);
    }

    _toNumber(value) {
        const n = Number(value);
        return Number.isFinite(n) ? Math.max(n, 0) : 0;
    }

    _parseDayKey(dayKey) {
        const parts = String(dayKey || '').split('-');
        if (parts.length !== 3) return null;
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);
        const day = parseInt(parts[2], 10);
        if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
            return null;
        }
        return new Date(Date.UTC(year, month - 1, day));
    }

    _formatDayKey(date) {
        const y = date.getUTCFullYear();
        const m = String(date.getUTCMonth() + 1).padStart(2, '0');
        const d = String(date.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    _normalizeRows(rows = []) {
        const map = new Map();

        rows.forEach((row) => {
            const dayKey = String(row?.day_key || '').trim();
            const dayDate = this._parseDayKey(dayKey);
            if (!dayDate) return;

            const safeDayKey = this._formatDayKey(dayDate);
            const current = map.get(safeDayKey) || {
                day_key: safeDayKey,
                input_tokens: 0,
                output_tokens: 0,
                total_tokens: 0,
            };

            const input = this._toNumber(row?.input_tokens);
            const output = this._toNumber(row?.output_tokens);
            const total = this._toNumber(row?.total_tokens) || (input + output);

            current.input_tokens += input;
            current.output_tokens += output;
            current.total_tokens += total;
            map.set(safeDayKey, current);
        });

        return Array.from(map.values()).sort((a, b) => a.day_key.localeCompare(b.day_key));
    }

    _buildContinuousSeries(rows = [], days = 7) {
        const normalized = this._normalizeRows(rows);
        const rowMap = new Map(normalized.map(item => [item.day_key, item]));
        const now = new Date();
        const utcToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        const series = [];

        for (let i = days - 1; i >= 0; i -= 1) {
            const date = new Date(utcToday);
            date.setUTCDate(utcToday.getUTCDate() - i);
            const dayKey = this._formatDayKey(date);
            const row = rowMap.get(dayKey) || {
                day_key: dayKey,
                input_tokens: 0,
                output_tokens: 0,
                total_tokens: 0,
            };
            series.push(row);
        }

        return series;
    }

    async loadData(days) {
        this.showLoading();

        try {
            const response = await this.aios._callAuthorizedApi(`/api/usage/daily?limit=${days}`);
            if (!response || !response.ok || !Array.isArray(response.rows)) {
                throw new Error('No usage data available');
            }

            this.dailyData = this._normalizeRows(response.rows);
            this.chartData = this._buildContinuousSeries(response.rows, days);

            if (!this.dailyData.length) {
                this.showError('No usage data for this period');
                return;
            }

            const rendered = this.renderChart();
            if (!rendered) return;

            this.updateStats();
            this.showChart();
        } catch (error) {
            console.error('Error loading usage data:', error);
            this.showError(error.message || 'Failed to load');
        }
    }

    showLoading() {
        this.elements.loading?.classList.remove('hidden');
        this.elements.error?.classList.add('hidden');
        this.elements.canvasContainer?.classList.add('hidden');
    }

    showError(message) {
        this.elements.loading?.classList.add('hidden');
        this.elements.error?.classList.remove('hidden');
        this.elements.canvasContainer?.classList.add('hidden');
        if (this.elements.errorMessage) {
            this.elements.errorMessage.textContent = message;
        }
    }

    showChart() {
        this.elements.loading?.classList.add('hidden');
        this.elements.error?.classList.add('hidden');
        this.elements.canvasContainer?.classList.remove('hidden');
    }

    renderChart() {
        if (!this.elements.canvas) {
            this.showError('Graph canvas not found');
            return false;
        }
        if (!window.Chart) {
            this.showError('Chart library failed to load');
            return false;
        }

        if (this.chart) {
            this.chart.destroy();
        }

        const data = this.chartData.length ? this.chartData : this.dailyData;
        const labels = data.map(d => {
            const date = this._parseDayKey(d.day_key);
            if (!date) return d.day_key;
            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
        });

        const inputTokens = data.map(d => this._toNumber(d.input_tokens));
        const outputTokens = data.map(d => this._toNumber(d.output_tokens));
        const totalTokens = data.map(d => this._toNumber(d.total_tokens));

        const isDark = document.body.classList.contains('dark-mode');
        const colors = isDark ? {
            primary: '#e8e8ec',
            secondary: '#b0b0b8',
            tertiary: '#787880',
            text: '#f0f0f0',
            textSecondary: 'rgba(240, 240, 240, 0.60)',
            grid: 'rgba(255, 255, 255, 0.06)'
        } : {
            primary: '#2d3748',
            secondary: '#4a5568',
            tertiary: '#718096',
            text: '#1a202c',
            textSecondary: 'rgba(26, 32, 44, 0.70)',
            grid: 'rgba(0, 0, 0, 0.06)'
        };

        const ctx = this.elements.canvas.getContext('2d');
        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Total',
                        data: totalTokens,
                        borderColor: colors.primary,
                        backgroundColor: isDark ? 'rgba(255, 217, 61, 0.1)' : 'rgba(232, 185, 35, 0.1)',
                        borderWidth: 3,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 4,
                        pointHoverRadius: 6,
                        pointBackgroundColor: colors.primary,
                        pointBorderColor: isDark ? '#000000' : '#FFFFFF',
                        pointBorderWidth: 2,
                        pointHoverBorderWidth: 3,
                    },
                    {
                        label: 'Input',
                        data: inputTokens,
                        borderColor: colors.secondary,
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        fill: false,
                        tension: 0.4,
                        pointRadius: 3,
                        pointHoverRadius: 5,
                        pointBackgroundColor: colors.secondary,
                        pointBorderColor: isDark ? '#000000' : '#FFFFFF',
                        pointBorderWidth: 2,
                    },
                    {
                        label: 'Output',
                        data: outputTokens,
                        borderColor: colors.tertiary,
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        fill: false,
                        tension: 0.4,
                        pointRadius: 3,
                        pointHoverRadius: 5,
                        pointBackgroundColor: colors.tertiary,
                        pointBorderColor: isDark ? '#000000' : '#FFFFFF',
                        pointBorderWidth: 2,
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                animation: {
                    duration: 800,
                    easing: 'easeInOutCubic',
                    delay: (context) => {
                        let delay = 0;
                        if (context.type === 'data' && context.mode === 'default') {
                            delay = context.dataIndex * 30;
                        }
                        return delay;
                    }
                },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        align: 'end',
                        labels: {
                            color: colors.text,
                            font: {
                                size: 11,
                                weight: '600',
                                family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
                            },
                            padding: 12,
                            usePointStyle: true,
                            pointStyle: 'circle',
                            boxWidth: 8,
                            boxHeight: 8
                        }
                    },
                    tooltip: {
                        backgroundColor: isDark ? 'rgba(8, 8, 8, 0.95)' : 'rgba(255, 255, 255, 0.95)',
                        titleColor: colors.text,
                        bodyColor: colors.textSecondary,
                        borderColor: colors.primary,
                        borderWidth: 1,
                        padding: 12,
                        displayColors: true,
                        boxWidth: 10,
                        boxHeight: 10,
                        boxPadding: 4,
                        cornerRadius: 8,
                        titleFont: {
                            size: 12,
                            weight: '600'
                        },
                        bodyFont: {
                            size: 11,
                            weight: '500'
                        },
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                label += context.parsed.y.toLocaleString();
                                return label;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: {
                            color: colors.grid,
                            drawBorder: false,
                        },
                        ticks: {
                            color: colors.textSecondary,
                            font: {
                                size: 10,
                                weight: '500'
                            }
                        }
                    },
                    y: {
                        beginAtZero: true,
                        grid: {
                            color: colors.grid,
                            drawBorder: false,
                        },
                        ticks: {
                            color: colors.textSecondary,
                            font: {
                                size: 10,
                                weight: '500'
                            },
                            callback: function(value) {
                                if (value >= 1000000) {
                                    return (value / 1000000).toFixed(1) + 'M';
                                } else if (value >= 1000) {
                                    return (value / 1000).toFixed(0) + 'K';
                                }
                                return value;
                            }
                        }
                    }
                }
            }
        });
        return true;
    }

    updateStats() {
        const source = this.chartData.length ? this.chartData : this.dailyData;
        if (!source || source.length === 0) {
            if (this.elements.statAvg) this.elements.statAvg.textContent = '-';
            if (this.elements.statPeak) this.elements.statPeak.textContent = '-';
            if (this.elements.statTotal) this.elements.statTotal.textContent = '-';
            return;
        }

        const totals = source.map(d => this._toNumber(d.total_tokens));
        const sum = totals.reduce((a, b) => a + b, 0);
        const avg = Math.round(sum / totals.length);
        const peak = Math.max(...totals);

        if (this.elements.statAvg) this.elements.statAvg.textContent = this.formatNumber(avg);
        if (this.elements.statPeak) this.elements.statPeak.textContent = this.formatNumber(peak);
        if (this.elements.statTotal) this.elements.statTotal.textContent = this.formatNumber(sum);
    }

    formatNumber(value) {
        const numeric = Number(value) || 0;
        if (numeric >= 1000000) {
            return (numeric / 1000000).toFixed(2) + 'M';
        } else if (numeric >= 1000) {
            return (numeric / 1000).toFixed(1) + 'K';
        }
        return numeric.toLocaleString();
    }
}

window.AIOSUsageGraph = AIOSUsageGraph;
