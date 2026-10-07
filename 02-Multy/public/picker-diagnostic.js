// Observe a picker call without ever touching the returned device's GATT.
export class PickerDiagnostic {
  constructor({ timeoutMs = 20000, tickMs = 1000, onProgress = () => {}, onReturned = () => {} } = {}) {
    Object.assign(this, { timeoutMs, tickMs, onProgress, onReturned });
  }
  start(invoke) {
    if (this.active) return Promise.reject(new Error('已有選擇呼叫正在等待。'));
    return new Promise(resolve => {
      const attempt = { done: false, deadline: Date.now() + this.timeoutMs };
      this.active = attempt;
      const finish = outcome => {
        if (attempt.done) return;
        attempt.done = true; clearTimeout(attempt.timer); clearInterval(attempt.ticker);
        this.active = null; resolve(outcome);
      };
      attempt.cancel = () => finish({ status: 'cancelled' });
      const progress = () => this.onProgress(Math.max(0, Math.ceil((attempt.deadline - Date.now()) / 1000)));
      // Arm the deadline before invoking the bridge. No await before invoke.
      attempt.timer = setTimeout(() => finish({ status: 'timeout' }), this.timeoutMs);
      attempt.ticker = setInterval(progress, this.tickMs);
      progress();
      try {
        const selection = invoke(); this.onReturned();
        Promise.resolve(selection).then(device => finish({ status: 'selected', device }), error => finish({ status: 'error', error }));
      } catch (error) { finish({ status: 'error', error }); }
    });
  }
  cancel() { this.active?.cancel(); }
}
