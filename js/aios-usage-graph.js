// aios-usage-graph.js - Inline Daily Usage Graph Component

class AIOSUsageGraph {
    constructor(aiosInstance) {
        this.aios = aiosInstance;
        this.chart = null;
        this.currentPeriod = 7;
        this.dailyData = [];
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
                const period = parseInt(e.target.dataset.period);
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
            // Show graph view
            this.elements.summaryView?.classList.add('hidden');
            this.elements.graphView?.classList.remove('hidden');
            this.elements.toggleBtn?.classList.add('active');
            
            // Load data if not already loaded
            if (this.dailyData.length === 0) {
                await this.loadData(this.currentPeriod);
            }
        } else {
            // Show summary view
            this.elements.summaryView?.classList.remove('hidden');
            this.elements.graphView?.classList.add('hidden');
            this.elements.toggleBtn?.classList.remove('active');
        }
    }

    async changePeriod(period) {
        this.currentPeriod = period;
        
        this.elements.periodBtns?.forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.dataset.period) === period);
        });

        await this.loadData(period);
    }

    async loadData(days) {
        this.showLoading();

        try {
            const response = await this.aios._callAuthorizedApi(`/api/usage/daily?limit=${days}`);
            
            if (!response || !response.ok || !response.rows) {
                throw new Error('No usage data available');
            }

            this.dailyData = response.rows;
            
            if (this.dailyData.length === 0) {
                this.showError('No usage data for this period');
                return;
            }

            this.renderChart();
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
        if (!this.elements.canvas || !window.Chart) {
            console.error('Chart.js not loaded or canvas not found');
            return;
        }

        if (this.chart) {
            this.chart.destroy();
        }

        const sortedData = [...this.dailyData].sort((a, b) => {
            return new Date(a.day_key) - new Date(b.day_key);
        });

        const labels = sortedData.map(d => {
            const date = new Date(d.day_key);
            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        });

        const inputTokens = sortedData.map(d => d.input_tokens || 0);
        const outputTokens = sortedData.map(d => d.output_tokens || 0);
        const totalTokens = sortedData.map(d => d.total_tokens || 0);

        // Detect theme
        const isDark = !document.documentElement.hasAttribute('data-theme') || 
                       document.documentElement.getAttribute('data-theme') === 'dark';
        
        const colors = isDark ? {
            primary: '#FFD93D',
            secondary: '#F6C445',
            tertiary: '#FFA500',
            text: '#FFF8E7',
            textSecondary: 'rgba(255, 248, 231, 0.7)',
            grid: 'rgba(255, 217, 61, 0.08)'
        } : {
            primary: '#E8B923',
            secondary: '#D4A017',
            tertiary: '#C89116',
            text: '#1A1A1A',
            textSecondary: 'rgba(26, 26, 26, 0.7)',
            grid: 'rgba(232, 185, 35, 0.1)'
        };

        const ctx = this.elements.canvas.getContext('2d');
        
        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
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
                        pointBorderColor: isDark ? '#1A1A1A' : '#FFFFFF',
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
                        pointBorderColor: isDark ? '#1A1A1A' : '#FFFFFF',
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
                        pointBorderColor: isDark ? '#1A1A1A' : '#FFFFFF',
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
                        backgroundColor: isDark ? 'rgba(26, 26, 26, 0.95)' : 'rgba(255, 248, 231, 0.95)',
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
    }

    updateStats() {
        if (!this.dailyData || this.dailyData.length === 0) {
            this.elements.statAvg.textContent = '-';
            this.elements.statPeak.textContent = '-';
            this.elements.statTotal.textContent = '-';
            return;
        }

        const totals = this.dailyData.map(d => d.total_tokens || 0);
        const sum = totals.reduce((a, b) => a + b, 0);
        const avg = Math.round(sum / totals.length);
        const peak = Math.max(...totals);

        this.elements.statAvg.textContent = this.formatNumber(avg);
        this.elements.statPeak.textContent = this.formatNumber(peak);
        this.elements.statTotal.textContent = this.formatNumber(sum);
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
