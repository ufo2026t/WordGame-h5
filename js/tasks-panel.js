import { getTaskInfo } from './game-config.js';

export class TasksPanel {
  constructor(modalEl, api) {
    this.modal = modalEl;
    this.api = api;
    this.tab = 'active';
    this.modal.querySelector('[data-close="tasks"]').addEventListener('click', () => this.close());
    this.modal.querySelectorAll('.tasks-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.tab = btn.dataset.tab;
        this.modal.querySelectorAll('.tasks-tab').forEach((b) => b.classList.toggle('active', b === btn));
        this.render();
      });
    });
    this.modal.addEventListener('click', (e) => {
      const abandon = e.target.closest('[data-abandon-task]');
      if (abandon) {
        this.abandonTask(abandon.dataset.abandonTask);
        return;
      }
      if (e.target.closest('[data-clear-completed]')) {
        this.clearCompleted();
        return;
      }
      if (e.target.closest('[data-clear-messages]')) {
        this.clearMessages();
      }
    });
  }

  open() {
    this.tab = 'active';
    this.modal.querySelectorAll('.tasks-tab').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === this.tab);
    });
    this.render();
    this.modal.classList.remove('hidden');
  }

  close() {
    this.modal.classList.add('hidden');
  }

  renderIfOpen() {
    if (!this.modal.classList.contains('hidden')) this.render();
  }

  abandonTask(id) {
    if (!window.confirm(`是否放弃任务 ${id}？`)) return;
    this.api.game_del_res_event(id);
    delete this.api.state.tasks[String(id)];
    this.api.persist();
    this.api.game_reload_chatlist();
    this.render();
  }

  clearCompleted() {
    if (!window.confirm('是否清空这些已完成的任务列表？该操作不会去除已经获得的经验值和物品。')) return;
    const tasks = this.api.state.tasks || {};
    for (const [id, task] of Object.entries(tasks)) {
      if (task.completed) delete tasks[id];
    }
    this.api.persist();
    this.render();
  }

  clearMessages() {
    if (!window.confirm('是否清空这些提示消息？')) return;
    this.api.state.messages = [];
    this.api.persist();
    this.render();
  }

  renderTaskItem(id, task) {
    const info = getTaskInfo(id);
    const desc = info?.text ? `<div class="trade-desc">${escapeHtml(info.text)}</div>` : '';
    const status = task.completed
      ? '<span class="task-status done">已完成</span>'
      : '<span class="task-status active">进行中</span>';
    const abandon = !task.completed
      ? `<button type="button" class="task-action" data-abandon-task="${escapeHtml(id)}">删除</button>`
      : '';
    return `<li><div class="task-main"><strong>任务 ${escapeHtml(id)}</strong>${desc}</div><div class="task-actions">${status}${abandon}</div></li>`;
  }

  render() {
    const body = this.modal.querySelector('#tasks-body');
    const stats = this.api.state.wordStats || { correct: 0, wrong: 0 };
    const tasks = Object.entries(this.api.state.tasks || {});
    const active = tasks.filter(([, t]) => t.active && !t.completed);
    const completed = tasks.filter(([, t]) => t.completed);
    const messages = Array.isArray(this.api.state.messages) ? this.api.state.messages : [];

    let html = `
      <section class="panel-section compact-stats">
        <p class="panel-quote">背单词统计：正确 ${stats.correct} · 错误 ${stats.wrong}</p>
      </section>`;

    if (this.tab === 'active') {
      html += '<section class="panel-section"><h3>未完成的任务</h3>';
      if (!active.length) {
        html += '<p class="panel-empty">暂无进行中的任务</p>';
      } else {
        html += `<ul class="task-list">${active.map(([id, t]) => this.renderTaskItem(id, t)).join('')}</ul>`;
      }
      html += '</section>';
    } else if (this.tab === 'completed') {
      html += '<section class="panel-section"><div class="panel-toolbar"><h3>已完成的任务</h3>';
      if (completed.length) {
        html += '<button type="button" class="task-action" data-clear-completed>清空列表</button>';
      }
      html += '</div>';
      if (!completed.length) {
        html += '<p class="panel-empty">暂无已完成任务</p>';
      } else {
        html += `<ul class="task-list">${completed.map(([id, t]) => this.renderTaskItem(id, t)).join('')}</ul>`;
      }
      html += '</section>';
    } else {
      html += '<section class="panel-section"><div class="panel-toolbar"><h3>消息</h3>';
      if (messages.length) {
        html += '<button type="button" class="task-action" data-clear-messages>清空消息</button>';
      }
      html += '</div>';
      if (!messages.length) {
        html += '<p class="panel-empty">暂无提示消息</p>';
      } else {
        html += `<ul class="message-list">${messages.map((m) => `<li>${escapeHtml(String(m))}</li>`).join('')}</ul>`;
      }
      html += '</section>';
    }

    body.innerHTML = html;
  }
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
