// Shared download limit for each cache; reject floods instead of growing forever.
class TaskQueue {
  constructor(concurrency = 3, capacity = 64) {
    this.concurrency = concurrency;
    this.capacity = capacity;
    this.active = 0;
    this.waiting = [];
  }
  run(task) {
    if (this.waiting.length >= this.capacity)
      return Promise.reject(new Error('Download queue full'));
    return new Promise((resolve, reject) => {
      this.waiting.push({ task, resolve, reject });
      this.drain();
    });
  }
  drain() {
    while (this.active < this.concurrency && this.waiting.length) {
      const { task, resolve, reject } = this.waiting.shift();
      this.active++;
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          this.active--;
          this.drain();
        });
    }
  }
}
module.exports = { TaskQueue };
