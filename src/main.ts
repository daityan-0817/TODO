import './style.css'

type TaskStatus = 'open' | 'done'
type TaskPriority = 'none' | 'low' | 'medium' | 'high'
type ViewKey = 'today' | 'inbox' | 'all'
type DueFilter = 'all' | 'none' | 'has' | 'overdue' | 'today' | 'upcoming'
type CompletionFilter = 'open' | 'all'

type Task = {
  id: string
  title: string
  status: TaskStatus
  startAt: string | null
  dueAt: string | null
  priority: TaskPriority
  note: string
  createdAt: string
  updatedAt: string
  pinnedForToday: boolean
  inInbox: boolean
}

type UiState = {
  view: ViewKey
  showCompletedToday: boolean
  showCompletedInbox: boolean
  allSearch: string
  allCompletion: CompletionFilter
  allPriority: 'all' | TaskPriority
  allDue: DueFilter
  deleteConfirm: boolean
  newTaskTitle: string
  newTaskDueDate: string
  newTaskStartDate: string
  newTaskPriority: TaskPriority
  notificationsEnabled: boolean
  lastTodayNotificationDate: string
}

type UndoAction = {
  label: string
  expiresAt: number
  run: () => void
}

const STORAGE_KEY = 'todo-app-mvp-v1'
const UNDO_MS = 5000

class TodoTaskApplication {
  public start() {
    bootstrap()
  }
}

class TaskInputValidationService {
  static sanitizeTask = sanitizeTask
  static sanitizeUi = sanitizeUi
  static isPriority = isPriority
  static isDueFilter = isDueFilter
}

class TaskDateCalculationService {
  static isOverdue = isOverdue
  static isDueToday = isDueToday
  static isUpcoming = isUpcoming
  static getDueBadge = getDueBadge
  static isoFromDateInputValue = isoFromDateInputValue
  static toDateInputValue = toDateInputValue
}

class TaskQueryService {
  static sortTasks = sortTasks
  static getTodayGroups = getTodayGroups
  static getDateBoxGroups = getDateBoxGroups
  static getAllViewTasks = getAllViewTasks
}

class TaskTextPresentationService {
  static priorityLabel = priorityLabel
  static escapeHtml = escapeHtml
}

const app = document.querySelector<HTMLDivElement>('#app')!

let tasks: Task[] = []
let ui: UiState = {
  view: 'today',
  showCompletedToday: false,
  showCompletedInbox: false,
  allSearch: '',
  allCompletion: 'open',
  allPriority: 'all',
  allDue: 'all',
  deleteConfirm: true,
  newTaskTitle: '',
  newTaskDueDate: '',
  newTaskStartDate: '',
  newTaskPriority: 'none',
  notificationsEnabled: false,
  lastTodayNotificationDate: '',
}
let undoAction: UndoAction | null = null
let notificationTimerId: number | null = null

new TodoTaskApplication().start()

function bootstrap() {
  loadState()
  render()
  document.addEventListener('keydown', onGlobalKeyDown)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      maybeNotifyTodayTasks()
    }
  })
  startNotificationScheduler()
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as { tasks?: unknown; ui?: Partial<UiState> }
    if (Array.isArray(parsed.tasks)) {
      tasks = parsed.tasks
        .map(sanitizeTask)
        .filter((task): task is Task => task !== null)
    }
    if (parsed.ui && typeof parsed.ui === 'object') {
      ui = {
        ...ui,
        ...TaskInputValidationService.sanitizeUi(parsed.ui),
      }
    }
  } catch {
    // Ignore broken local state and start fresh.
  }
}

function sanitizeTask(input: unknown): Task | null {
  if (!input || typeof input !== 'object') return null
  const row = input as Record<string, unknown>
  const nowIso = new Date().toISOString()
  const title = typeof row.title === 'string' ? row.title.trim() : ''
  if (!title) return null
  return {
    id: typeof row.id === 'string' ? row.id : crypto.randomUUID(),
    title,
    status: row.status === 'done' ? 'done' : 'open',
    startAt: typeof row.startAt === 'string' && row.startAt ? row.startAt : null,
    dueAt: typeof row.dueAt === 'string' && row.dueAt ? row.dueAt : null,
    priority: TaskInputValidationService.isPriority(row.priority) ? row.priority : 'none',
    note: typeof row.note === 'string' ? row.note : '',
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : nowIso,
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : nowIso,
    pinnedForToday: Boolean(row.pinnedForToday),
    inInbox: row.inInbox === false ? false : true,
  }
}

function sanitizeUi(input: Partial<UiState>): Partial<UiState> {
  return {
    showCompletedToday: Boolean(input.showCompletedToday),
    showCompletedInbox: Boolean(input.showCompletedInbox),
    allSearch: typeof input.allSearch === 'string' ? input.allSearch : '',
    allCompletion: input.allCompletion === 'all' ? 'all' : 'open',
    allPriority: input.allPriority === 'all' || TaskInputValidationService.isPriority(input.allPriority) ? input.allPriority : 'all',
    allDue: TaskInputValidationService.isDueFilter(input.allDue) ? input.allDue : 'all',
    deleteConfirm: typeof input.deleteConfirm === 'boolean' ? input.deleteConfirm : true,
    newTaskTitle: '',
    newTaskDueDate: typeof input.newTaskDueDate === 'string' ? input.newTaskDueDate : '',
    newTaskStartDate: typeof input.newTaskStartDate === 'string' ? input.newTaskStartDate : '',
    newTaskPriority: TaskInputValidationService.isPriority(input.newTaskPriority) ? input.newTaskPriority : 'none',
    notificationsEnabled: typeof input.notificationsEnabled === 'boolean' ? input.notificationsEnabled : false,
    lastTodayNotificationDate: typeof input.lastTodayNotificationDate === 'string' ? input.lastTodayNotificationDate : '',
  }
}

function isPriority(value: unknown): value is TaskPriority {
  return value === 'none' || value === 'low' || value === 'medium' || value === 'high'
}

function isDueFilter(value: unknown): value is DueFilter {
  return value === 'all' || value === 'none' || value === 'has' || value === 'overdue' || value === 'today' || value === 'upcoming'
}

function saveState() {
  const payload = {
    tasks,
    ui: {
      ...ui,
      newTaskTitle: '',
      newTaskDueDate: '',
      newTaskStartDate: '',
      newTaskPriority: 'none',
    },
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
}

function setUi(patch: Partial<UiState>) {
  ui = { ...ui, ...patch }
  saveState()
  render()
}

function setTasks(next: Task[]) {
  tasks = next
  saveState()
  render()
}

function updateTask(taskId: string, patch: Partial<Task>) {
  const nowIso = new Date().toISOString()
  setTasks(
    tasks.map((task) =>
      task.id === taskId
        ? {
            ...task,
            ...patch,
            updatedAt: nowIso,
          }
        : task,
    ),
  )
}

function removeTask(taskId: string) {
  const index = tasks.findIndex((task) => task.id === taskId)
  if (index < 0) return
  const task = tasks[index]
  if (ui.deleteConfirm && !window.confirm(`「${task.title}」を削除しますか？`)) {
    return
  }
  const next = tasks.filter((item) => item.id !== taskId)
  setUndo({
    label: 'タスクを削除しました',
    run: () => {
      const restored = [...tasks]
      if (restored.some((item) => item.id === task.id)) return
      restored.splice(index, 0, task)
      tasks = restored
      saveState()
      render()
    },
  })
  setTasks(next)
}

function setUndo(action: Omit<UndoAction, 'expiresAt'>) {
  undoAction = {
    ...action,
    expiresAt: Date.now() + UNDO_MS,
  }
  render()
}

function clearUndoIfExpired() {
  if (undoAction && Date.now() > undoAction.expiresAt) {
    undoAction = null
  }
}

function runUndo() {
  if (!undoAction) return
  const action = undoAction
  undoAction = null
  action.run()
}

function createTaskFromInput() {
  const quickAddInputElement = app.querySelector<HTMLInputElement>('#quick-add-input')
  const quickAddStartDateElement = app.querySelector<HTMLInputElement>('#quick-add-start-date')
  const quickAddPriorityElement = app.querySelector<HTMLSelectElement>('#quick-add-priority')

  if (quickAddInputElement) {
    ui.newTaskTitle = quickAddInputElement.value
  }
  if (quickAddStartDateElement) {
    ui.newTaskStartDate = quickAddStartDateElement.value
  }
  if (quickAddPriorityElement) {
    const selectedPriority = quickAddPriorityElement.value
    ui.newTaskPriority = TaskInputValidationService.isPriority(selectedPriority) ? selectedPriority : 'none'
  }

  const title = ui.newTaskTitle.trim()
  if (!title) {
    render({ addError: 'タイトルを入力してください。' })
    quickAddInputElement?.focus()
    return
  }
  const nowIso = new Date().toISOString()
  const startDateValue = ui.newTaskStartDate
  const task: Task = {
    id: crypto.randomUUID(),
    title,
    status: 'open',
    startAt: TaskDateCalculationService.isoFromDateInputValue(startDateValue),
    dueAt: null,
    priority: ui.newTaskPriority,
    note: '',
    createdAt: nowIso,
    updatedAt: nowIso,
    pinnedForToday: false,
    inInbox: false,
  }

  const savedTasks = [task, ...tasks]
  const shouldOpenTodayView = TaskDateCalculationService.isDueToday(task, new Date())

  tasks = savedTasks
  ui = {
    ...ui,
    view: shouldOpenTodayView ? 'today' : 'inbox',
    newTaskTitle: '',
    newTaskStartDate: '',
    newTaskPriority: 'none',
  }
  saveState()
  render()
  app.querySelector<HTMLInputElement>('#quick-add-input')?.focus()
}

function toggleTaskCompletion(taskId: string, nextStatus: TaskStatus) {
  const original = tasks.find((task) => task.id === taskId)
  if (!original) return
  if (original.status === nextStatus) return

  setUndo({
    label: nextStatus === 'done' ? 'タスクを完了しました' : '未完了に戻しました',
    run: () => {
      updateTask(taskId, { status: original.status })
    },
  })

  updateTask(taskId, { status: nextStatus })
}

function onGlobalKeyDown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  const tagName = target?.tagName
  const isTypingTarget =
    tagName === 'INPUT' || tagName === 'TEXTAREA' || target?.isContentEditable

  if (event.key === '/' && !isTypingTarget) {
    event.preventDefault()
    ui.view = 'all'
    saveState()
    render()
    app.querySelector<HTMLInputElement>('#all-search')?.focus()
    return
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && undoAction) {
    event.preventDefault()
    runUndo()
  }
}

function render(options?: { addError?: string }) {
  clearUndoIfExpired()

  const now = new Date()
  const todayGroups = TaskQueryService.getTodayGroups(tasks, now)
  const dateBoxTasks = TaskQueryService.sortTasks(tasks, now)
  const allViewTasks = TaskQueryService.getAllViewTasks(tasks, ui, now)

  const shellTemplate = document.querySelector<HTMLTemplateElement>('#app-shell-template')
  if (!shellTemplate) {
    throw new Error('#app-shell-template not found')
  }

  app.innerHTML = shellTemplate.innerHTML

  const navRoot = app.querySelector<HTMLElement>('#nav-root')
  const quickAddInput = app.querySelector<HTMLInputElement>('#quick-add-input')
  const quickAddStartDate = app.querySelector<HTMLInputElement>('#quick-add-start-date')
  const quickAddStartDateDisplay = app.querySelector<HTMLElement>('#quick-add-start-date-display')
  const quickAddPriority = app.querySelector<HTMLSelectElement>('#quick-add-priority')
  const deleteConfirmToggle = app.querySelector<HTMLInputElement>('#delete-confirm-toggle')
  const notificationSettingsSlot = app.querySelector<HTMLElement>('#notification-settings-slot')
  const errorSlot = app.querySelector<HTMLElement>('#quick-add-error-slot')
  const viewRoot = app.querySelector<HTMLElement>('#view-root')
  const undoRoot = app.querySelector<HTMLElement>('#undo-root')

  if (!navRoot || !quickAddInput || !quickAddStartDate || !quickAddStartDateDisplay || !quickAddPriority || !deleteConfirmToggle || !notificationSettingsSlot || !errorSlot || !viewRoot || !undoRoot) {
    throw new Error('render roots not found')
  }

  navRoot.innerHTML = `
    ${renderNavButton('today', '今日', todayGroups.openCount)}
    ${renderNavButton('inbox', '日付ボックス', dateBoxTasks.filter((t) => t.status === 'open').length)}
    ${renderNavButton('all', 'すべて', tasks.length)}
  `

  quickAddInput.value = ui.newTaskTitle
  quickAddStartDate.value = ui.newTaskStartDate
  quickAddStartDateDisplay.textContent = formatDatePickerDisplayText(ui.newTaskStartDate, '開始日を選択')
  quickAddPriority.value = ui.newTaskPriority
  quickAddInput.setAttribute('aria-describedby', options?.addError ? 'quick-add-help quick-add-error' : 'quick-add-help')
  deleteConfirmToggle.checked = ui.deleteConfirm
  notificationSettingsSlot.innerHTML = renderNotificationSettings()
  errorSlot.innerHTML = options?.addError
    ? `<p id="quick-add-error" class="error-text" role="alert">${TaskTextPresentationService.escapeHtml(options.addError)}</p>`
    : ''

  viewRoot.innerHTML = [
    ui.view === 'today' ? renderTodayView(todayGroups) : '',
    ui.view === 'inbox' ? renderDateBoxView(dateBoxTasks, now) : '',
    ui.view === 'all' ? renderAllView(allViewTasks) : '',
  ].join('')

  undoRoot.innerHTML = renderUndoBar()

  bindEvents()
  maybeNotifyTodayTasks()
}

function renderNavButton(view: ViewKey, label: string, count: number) {
  return `
    <button
      class="nav-button ${ui.view === view ? 'is-active' : ''}"
      type="button"
      data-action="switch-view"
      data-view="${view}"
      aria-current="${ui.view === view ? 'page' : 'false'}"
    >
      <span>${label}</span>
      <span class="count">${count}</span>
    </button>
  `
}

function renderTodayView(groups: ReturnType<typeof getTodayGroups>) {
  return `
    <section class="panel">
      <div class="panel-head">
        <h3>今日やること</h3>
        <label class="toggle-row">
          <input type="checkbox" data-action="toggle-show-completed-today" ${ui.showCompletedToday ? 'checked' : ''} />
          <span>完了も表示</span>
        </label>
      </div>
      <p class="subtle">遅れ → 今日期限 → 今日にピン留め の順で自動表示します。</p>
      ${renderTodaySection('遅れ', groups.overdueOpen, groups.overdueDone, ui.showCompletedToday)}
      ${renderTodaySection('今日期限', groups.todayOpen, groups.todayDone, ui.showCompletedToday)}
      ${renderTodaySection('今日にピン留め', groups.pinnedOpen, groups.pinnedDone, ui.showCompletedToday)}
      ${groups.openCount === 0 ? '<p class="empty">今日の未完了タスクはありません。</p>' : ''}
    </section>
  `
}

function renderTodaySection(
  title: string,
  openItems: Task[],
  doneItems: Task[],
  showCompleted: boolean,
) {
  const visibleDone = showCompleted ? doneItems : []
  if (openItems.length === 0 && visibleDone.length === 0) {
    return `
      <section class="section-block">
        <div class="section-title">${title}</div>
        <p class="empty small">該当タスクなし</p>
      </section>
    `
  }

  return `
    <section class="section-block">
      <div class="section-title">${title}</div>
      <ul class="task-list" aria-label="${title}">
        ${openItems.map((task) => renderTaskItem(task)).join('')}
        ${visibleDone.map((task) => renderTaskItem(task)).join('')}
      </ul>
    </section>
  `
}

function renderDateBoxView(items: Task[], now: Date) {
  const groups = TaskQueryService.getDateBoxGroups(items, now)
  const hiddenDoneCount = ui.showCompletedInbox
    ? 0
    : items.filter((task) => task.status === 'done').length

  return `
    <section class="panel">
      <div class="panel-head">
        <h3>日付ボックス</h3>
        <label class="toggle-row">
          <input type="checkbox" data-action="toggle-show-completed-inbox" ${ui.showCompletedInbox ? 'checked' : ''} />
          <span>完了も表示</span>
        </label>
      </div>
      <p class="subtle">日付ごとのボックスに自動整理。各ボックス内は優先度順に並びます。</p>
      ${renderDateBoxGroups(groups, ui.showCompletedInbox)}
      ${hiddenDoneCount > 0 ? `<p class="subtle">${hiddenDoneCount}件の完了タスクを非表示中</p>` : ''}
    </section>
  `
}

function renderAllView(items: Task[]) {
  const groups = TaskQueryService.getDateBoxGroups(items, new Date())
  return `
    <section class="panel">
      <div class="panel-head">
        <h3>すべて</h3>
        <p class="subtle">${items.length}件表示</p>
      </div>
      <div class="filters">
        <div class="field">
          <label for="all-search">検索</label>
          <input id="all-search" type="search" placeholder="タイトル / メモ" value="${TaskTextPresentationService.escapeHtml(ui.allSearch)}" />
        </div>
        <div class="field">
          <label for="filter-completion">表示</label>
          <select id="filter-completion">
            <option value="open" ${ui.allCompletion === 'open' ? 'selected' : ''}>未完了のみ</option>
            <option value="all" ${ui.allCompletion === 'all' ? 'selected' : ''}>完了含む</option>
          </select>
        </div>
        <div class="field">
          <label for="filter-priority">優先度</label>
          <select id="filter-priority">
            <option value="all" ${ui.allPriority === 'all' ? 'selected' : ''}>すべて</option>
            <option value="none" ${ui.allPriority === 'none' ? 'selected' : ''}>未設定</option>
            <option value="high" ${ui.allPriority === 'high' ? 'selected' : ''}>高</option>
            <option value="medium" ${ui.allPriority === 'medium' ? 'selected' : ''}>中</option>
            <option value="low" ${ui.allPriority === 'low' ? 'selected' : ''}>低</option>
          </select>
        </div>
        <div class="field">
          <label for="filter-due">期限</label>
          <select id="filter-due">
            <option value="all" ${ui.allDue === 'all' ? 'selected' : ''}>すべて</option>
            <option value="none" ${ui.allDue === 'none' ? 'selected' : ''}>期限なし</option>
            <option value="has" ${ui.allDue === 'has' ? 'selected' : ''}>期限あり</option>
            <option value="overdue" ${ui.allDue === 'overdue' ? 'selected' : ''}>遅れ</option>
            <option value="today" ${ui.allDue === 'today' ? 'selected' : ''}>今日</option>
            <option value="upcoming" ${ui.allDue === 'upcoming' ? 'selected' : ''}>今後</option>
          </select>
        </div>
      </div>
      ${renderDateBoxGroups(groups, ui.allCompletion === 'all')}
    </section>
  `
}

function renderTaskItem(task: Task) {
  const dueBadge = TaskDateCalculationService.getDueBadge(task)
  const startInputValue = TaskDateCalculationService.toDateInputValue(task.startAt)
  const taskDatePickerDisplayText = formatDatePickerDisplayText(startInputValue, '日付を設定')
  const isDone = task.status === 'done'
  return `
    <li class="task-item ${isDone ? 'is-done' : ''}">
      <div class="task-main">
        <div class="task-headline">
          <label class="check-wrap">
            <input
              type="checkbox"
              data-action="toggle-complete"
              data-task-id="${task.id}"
              ${isDone ? 'checked' : ''}
              aria-label="${isDone ? '未完了に戻す' : '完了にする'}: ${TaskTextPresentationService.escapeHtml(task.title)}"
            />
            <span class="check-visual" aria-hidden="true"></span>
          </label>
          <div class="task-texts">
            <input
              class="title-input"
              type="text"
              value="${TaskTextPresentationService.escapeHtml(task.title)}"
              data-action="update-title"
              data-task-id="${task.id}"
              maxlength="120"
              aria-label="タスクタイトル"
            />
            <div class="task-meta">
              <span class="badge">${TaskTextPresentationService.priorityLabel(task.priority)}</span>
              ${dueBadge ? `<span class="badge">${TaskTextPresentationService.escapeHtml(dueBadge)}</span>` : '<span class="badge muted">期限なし</span>'}
              ${task.pinnedForToday ? '<span class="badge">今日</span>' : ''}
            </div>
          </div>
        </div>
        <div class="task-controls" aria-label="整理操作">
          <button type="button" class="ghost-button" data-action="pin-today" data-task-id="${task.id}">
            ${task.pinnedForToday ? '今日から外す' : '今日に入れる'}
          </button>
          <div class="inline-field">
            <span>日付</span>
            <label class="calendar-date-picker-field inline-date-picker" aria-label="タスク日付を選択">
              <span class="calendar-date-picker-display-text">${TaskTextPresentationService.escapeHtml(taskDatePickerDisplayText)}</span>
              <input
                class="calendar-date-picker-native-input"
                type="date"
                value="${startInputValue}"
                data-action="update-start-date"
                data-task-id="${task.id}"
              />
            </label>
          </div>
          <label class="inline-field">
            <span>優先度</span>
            <select data-action="update-priority" data-task-id="${task.id}">
              <option value="none" ${task.priority === 'none' ? 'selected' : ''}>未設定</option>
              <option value="high" ${task.priority === 'high' ? 'selected' : ''}>高</option>
              <option value="medium" ${task.priority === 'medium' ? 'selected' : ''}>中</option>
              <option value="low" ${task.priority === 'low' ? 'selected' : ''}>低</option>
            </select>
          </label>
          <div class="row-actions">
            <button
              type="button"
              class="ghost-button"
              data-action="toggle-complete-button"
              data-task-id="${task.id}"
            >
              ${isDone ? '未完了に戻す' : '完了'}
            </button>
            <button type="button" class="danger-button" data-action="delete-task" data-task-id="${task.id}">削除</button>
          </div>
        </div>
        <label class="note-field">
          <span>メモ</span>
          <textarea
            rows="2"
            placeholder="補足メモ（任意）"
            data-action="update-note"
            data-task-id="${task.id}"
          >${TaskTextPresentationService.escapeHtml(task.note)}</textarea>
        </label>
      </div>
    </li>
  `
}

function renderUndoBar() {
  if (!undoAction) return ''
  const remaining = Math.max(0, Math.ceil((undoAction.expiresAt - Date.now()) / 1000))
  return `
    <div class="undo-bar" role="status" aria-live="polite">
      <span>${TaskTextPresentationService.escapeHtml(undoAction.label)}</span>
      <button type="button" data-action="undo">Undo</button>
      <small>${remaining}s</small>
    </div>
  `
}

function renderNotificationSettings() {
  const isMobileViewport =
    typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches
  if (isMobileViewport) return ''

  const supported = isNotificationSupported()
  const permission = getNotificationPermission()
  const permissionLabel =
    !supported ? 'このブラウザは通知未対応' : permission === 'granted' ? '通知許可済み' : permission === 'denied' ? '通知が拒否されています' : '通知未許可'

  return `
    <div class="notification-settings">
      <label class="toggle-row">
        <input
          id="notifications-enabled-toggle"
          type="checkbox"
          data-action="toggle-notifications-enabled"
          ${ui.notificationsEnabled ? 'checked' : ''}
          ${supported ? '' : 'disabled'}
        />
        <span>デスクトップ通知</span>
      </label>
      <p class="hint">${permissionLabel}</p>
      ${
        supported && permission !== 'granted'
          ? '<button type="button" class="ghost-button sidebar-button" data-action="request-notification-permission">通知を許可する</button>'
          : ''
      }
    </div>
  `
}

type DateBoxGroup = {
  key: string
  label: string
  openItems: Task[]
  doneItems: Task[]
}

function renderDateBoxGroups(groups: DateBoxGroup[], showCompleted: boolean) {
  if (groups.length === 0) {
    return '<p class="empty">表示できるタスクがありません。</p>'
  }

  return groups
    .map((group) => {
      const visibleDone = showCompleted ? group.doneItems : []
      const totalCount = group.openItems.length + visibleDone.length
      if (totalCount === 0) return ''
      return `
        <section class="date-box">
          <div class="date-box-head">
            <h4>${TaskTextPresentationService.escapeHtml(group.label)}</h4>
            <span class="count">${totalCount}件</span>
          </div>
          <ul class="task-list" aria-label="${TaskTextPresentationService.escapeHtml(group.label)}">
            ${group.openItems.map((task) => renderTaskItem(task)).join('')}
            ${visibleDone.map((task) => renderTaskItem(task)).join('')}
          </ul>
        </section>
      `
    })
    .join('')
}

function getDateBoxGroups(source: Task[], now: Date): DateBoxGroup[] {
  const map = new Map<string, { dateMs: number | null; openItems: Task[]; doneItems: Task[] }>()

  for (const task of source) {
    const start = taskStartDate(task)
    const end = taskEndDate(task)

    if (!start && !end) {
      const key = 'unscheduled'
      const bucket = map.get(key) ?? {
        dateMs: null,
        openItems: [],
        doneItems: [],
      }
      if (task.status === 'done') bucket.doneItems.push(task)
      else bucket.openItems.push(task)
      map.set(key, bucket)
      continue
    }

    const anchor = start ?? end!
    const key = localDateKey(anchor)
    const bucket = map.get(key) ?? {
      dateMs: localDateStartMsFromKey(key),
      openItems: [],
      doneItems: [],
    }
    if (task.status === 'done') bucket.doneItems.push(task)
    else bucket.openItems.push(task)
    map.set(key, bucket)
  }

  const groups = [...map.entries()].map(([key, bucket]) => ({
    key,
    label: key === 'unscheduled' ? '日付未設定' : formatDateBoxLabel(key, now),
    openItems: TaskQueryService.sortTasks(bucket.openItems, now),
    doneItems: TaskQueryService.sortTasks(bucket.doneItems, now),
    dateMs: bucket.dateMs,
  }))

  groups.sort((a, b) => {
    if (a.dateMs === null && b.dateMs === null) return 0
    if (a.dateMs === null) return 1
    if (b.dateMs === null) return -1
    return a.dateMs - b.dateMs
  })

  return groups.map(({ key, label, openItems, doneItems }) => ({
    key,
    label,
    openItems,
    doneItems,
  }))
}

function bindEvents() {
  const quickAddForm = app.querySelector<HTMLFormElement>('#quick-add-form')
  const quickAddInput = app.querySelector<HTMLInputElement>('#quick-add-input')
  const quickAddStartDate = app.querySelector<HTMLInputElement>('#quick-add-start-date')
  const quickAddPriority = app.querySelector<HTMLSelectElement>('#quick-add-priority')
  if (quickAddInput) {
    quickAddInput.addEventListener('input', (event) => {
      ui.newTaskTitle = (event.target as HTMLInputElement).value
      saveState()
    })
  }
  quickAddPriority?.addEventListener('change', (event) => {
    const value = (event.target as HTMLSelectElement).value
    ui.newTaskPriority = TaskInputValidationService.isPriority(value) ? value : 'none'
    saveState()
  })
  quickAddStartDate?.addEventListener('change', (event) => {
    ui.newTaskStartDate = (event.target as HTMLInputElement).value
    const quickAddDateDisplay = app.querySelector<HTMLElement>('#quick-add-start-date-display')
    if (quickAddDateDisplay) {
      quickAddDateDisplay.textContent = formatDatePickerDisplayText(ui.newTaskStartDate, '開始日を選択')
    }
    saveState()
  })
  quickAddForm?.addEventListener('submit', (event) => {
    event.preventDefault()
    createTaskFromInput()
  })

  app.querySelectorAll<HTMLElement>('[data-action]').forEach((element) => {
    const action = element.dataset.action

    if (element instanceof HTMLButtonElement || element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
      if (action === 'switch-view' && element instanceof HTMLButtonElement) {
        element.addEventListener('click', () => {
          const view = element.dataset.view as ViewKey | undefined
          if (!view) return
          setUi({ view })
        })
      }

      if (action === 'toggle-delete-confirm' && element instanceof HTMLInputElement) {
        element.addEventListener('change', () => setUi({ deleteConfirm: element.checked }))
      }

      if (action === 'toggle-notifications-enabled' && element instanceof HTMLInputElement) {
        element.addEventListener('change', () => {
          ui.notificationsEnabled = element.checked
          if (!element.checked) {
            saveState()
            render()
            return
          }

          const permission = getNotificationPermission()
          if (permission === 'default') {
            saveState()
            void requestNotificationPermission()
            return
          }

          saveState()
          render()
          maybeNotifyTodayTasks()
        })
      }

      if (action === 'request-notification-permission' && element instanceof HTMLButtonElement) {
        element.addEventListener('click', () => {
          void requestNotificationPermission()
        })
      }

      if (action === 'toggle-show-completed-today' && element instanceof HTMLInputElement) {
        element.addEventListener('change', () => setUi({ showCompletedToday: element.checked }))
      }

      if (action === 'toggle-show-completed-inbox' && element instanceof HTMLInputElement) {
        element.addEventListener('change', () => setUi({ showCompletedInbox: element.checked }))
      }

      if (action === 'toggle-complete' && element instanceof HTMLInputElement) {
        element.addEventListener('change', () => {
          const taskId = element.dataset.taskId
          if (!taskId) return
          const nextStatus: TaskStatus = element.checked ? 'done' : 'open'
          toggleTaskCompletion(taskId, nextStatus)
        })
      }

      if (action === 'toggle-complete-button' && element instanceof HTMLButtonElement) {
        element.addEventListener('click', () => {
          const taskId = element.dataset.taskId
          if (!taskId) return
          const task = tasks.find((item) => item.id === taskId)
          if (!task) return
          toggleTaskCompletion(taskId, task.status === 'done' ? 'open' : 'done')
        })
      }

      if (action === 'pin-today' && element instanceof HTMLButtonElement) {
        element.addEventListener('click', () => {
          const taskId = element.dataset.taskId
          if (!taskId) return
          const task = tasks.find((item) => item.id === taskId)
          if (!task) return
          updateTask(taskId, {
            pinnedForToday: !task.pinnedForToday,
          })
        })
      }

      if (action === 'delete-task' && element instanceof HTMLButtonElement) {
        element.addEventListener('click', () => {
          const taskId = element.dataset.taskId
          if (!taskId) return
          removeTask(taskId)
        })
      }

      if (action === 'undo' && element instanceof HTMLButtonElement) {
        element.addEventListener('click', () => runUndo())
      }

      if (action === 'update-title' && element instanceof HTMLInputElement) {
        element.addEventListener('blur', () => {
          const taskId = element.dataset.taskId
          if (!taskId) return
          const title = element.value.trim()
          const current = tasks.find((task) => task.id === taskId)
          if (!current) return
          if (!title) {
            element.value = current.title
            return
          }
          if (title !== current.title) updateTask(taskId, { title })
        })
      }

      if (action === 'update-start-date' && element instanceof HTMLInputElement) {
        element.addEventListener('change', () => {
          const taskId = element.dataset.taskId
          if (!taskId) return
          const startAt = TaskDateCalculationService.isoFromDateInputValue(element.value)
          updateTask(taskId, { startAt, dueAt: null })
        })
      }

      if (action === 'update-priority' && element instanceof HTMLSelectElement) {
        element.addEventListener('change', () => {
          const taskId = element.dataset.taskId
          if (!taskId) return
          const priority = TaskInputValidationService.isPriority(element.value) ? element.value : 'none'
          updateTask(taskId, { priority })
        })
      }

      if (action === 'update-note' && element instanceof HTMLTextAreaElement) {
        element.addEventListener('blur', () => {
          const taskId = element.dataset.taskId
          if (!taskId) return
          updateTask(taskId, { note: element.value })
        })
      }
    }
  })

  const allSearch = app.querySelector<HTMLInputElement>('#all-search')
  allSearch?.addEventListener('input', () => {
    ui = { ...ui, allSearch: allSearch.value }
    saveState()
    render()
    app.querySelector<HTMLInputElement>('#all-search')?.focus()
  })
  app.querySelector<HTMLSelectElement>('#filter-completion')?.addEventListener('change', (event) => {
    const value = (event.target as HTMLSelectElement).value === 'all' ? 'all' : 'open'
    setUi({ allCompletion: value })
  })
  app.querySelector<HTMLSelectElement>('#filter-priority')?.addEventListener('change', (event) => {
    const value = (event.target as HTMLSelectElement).value
    setUi({ allPriority: value === 'all' || TaskInputValidationService.isPriority(value) ? value : 'all' })
  })
  app.querySelector<HTMLSelectElement>('#filter-due')?.addEventListener('change', (event) => {
    const value = (event.target as HTMLSelectElement).value
    setUi({ allDue: TaskInputValidationService.isDueFilter(value) ? value : 'all' })
  })

  if (undoAction) {
    window.setTimeout(() => {
      if (undoAction && Date.now() > undoAction.expiresAt) {
        undoAction = null
        render()
      } else if (undoAction) {
        render()
      }
    }, 1000)
  }
}

function getTodayGroups(source: Task[], now: Date) {
  const open = source.filter((task) => task.status === 'open')
  const done = source.filter((task) => task.status === 'done')
  const seen = new Set<string>()

  const overdueOpen = TaskQueryService.sortTasks(
    open.filter((task) => {
      const hit = TaskDateCalculationService.isOverdue(task, now)
      if (hit) seen.add(task.id)
      return hit
    }),
    now,
  )
  const todayOpen = TaskQueryService.sortTasks(
    open.filter((task) => {
      const hit = !seen.has(task.id) && TaskDateCalculationService.isDueToday(task, now)
      if (hit) seen.add(task.id)
      return hit
    }),
    now,
  )
  const pinnedOpen = TaskQueryService.sortTasks(
    open.filter((task) => !seen.has(task.id) && task.pinnedForToday),
    now,
  )

  const seenDone = new Set<string>()
  const overdueDone = TaskQueryService.sortTasks(
    done.filter((task) => {
      const hit = TaskDateCalculationService.isOverdue(task, now)
      if (hit) seenDone.add(task.id)
      return hit
    }),
    now,
  )
  const todayDone = TaskQueryService.sortTasks(
    done.filter((task) => {
      const hit = !seenDone.has(task.id) && TaskDateCalculationService.isDueToday(task, now)
      if (hit) seenDone.add(task.id)
      return hit
    }),
    now,
  )
  const pinnedDone = TaskQueryService.sortTasks(done.filter((task) => !seenDone.has(task.id) && task.pinnedForToday), now)

  return {
    overdueOpen,
    overdueDone,
    todayOpen,
    todayDone,
    pinnedOpen,
    pinnedDone,
    openCount: overdueOpen.length + todayOpen.length + pinnedOpen.length,
  }
}

function isNotificationSupported() {
  return typeof window !== 'undefined' && 'Notification' in window
}

function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (!isNotificationSupported()) return 'unsupported'
  return Notification.permission
}

function startNotificationScheduler() {
  if (notificationTimerId !== null) {
    window.clearInterval(notificationTimerId)
  }
  notificationTimerId = window.setInterval(() => {
    maybeNotifyTodayTasks()
  }, 60_000)
}

function maybeNotifyTodayTasks() {
  if (!ui.notificationsEnabled) return
  if (getNotificationPermission() !== 'granted') return

  const now = new Date()
  const todayKey = localDateKey(now)
  if (ui.lastTodayNotificationDate === todayKey) return

  const effectiveTodayTasks = tasks.filter((task) => task.status === 'open' && TaskDateCalculationService.isDueToday(task, now))
  if (effectiveTodayTasks.length === 0) return

  const topTitles = TaskQueryService.sortTasks(effectiveTodayTasks, now)
    .slice(0, 3)
    .map((task) => task.title)
  const body =
    effectiveTodayTasks.length <= 3
      ? topTitles.join(' / ')
      : `${topTitles.join(' / ')} ほか${effectiveTodayTasks.length - 3}件`

  try {
    new Notification(`今日のタスクが${effectiveTodayTasks.length}件あります`, {
      body,
      tag: `todo-today-${todayKey}`,
    })
    ui.lastTodayNotificationDate = todayKey
    saveState()
  } catch {
    // Ignore notification runtime errors.
  }
}

async function requestNotificationPermission() {
  if (!isNotificationSupported()) return
  try {
    const result = await Notification.requestPermission()
    if (result === 'granted' && ui.notificationsEnabled) {
      maybeNotifyTodayTasks()
    }
    render()
  } catch {
    // Ignore permission prompt failures.
  }
}

function getAllViewTasks(source: Task[], currentUi: UiState, now: Date) {
  const query = currentUi.allSearch.trim().toLowerCase()
  const filtered = source.filter((task) => {
    if (currentUi.allCompletion === 'open' && task.status === 'done') return false
    if (currentUi.allPriority !== 'all' && task.priority !== currentUi.allPriority) return false
    if (!matchesDueFilter(task, currentUi.allDue, now)) return false
    if (query) {
      const haystack = `${task.title} ${task.note}`.toLowerCase()
      if (!haystack.includes(query)) return false
    }
    return true
  })
  return TaskQueryService.sortTasks(filtered, now)
}

function matchesDueFilter(task: Task, dueFilter: DueFilter, now: Date) {
  const hasRangeDate = Boolean(task.startAt || task.dueAt)
  switch (dueFilter) {
    case 'all':
      return true
    case 'none':
      return !hasRangeDate
    case 'has':
      return hasRangeDate
    case 'overdue':
      return TaskDateCalculationService.isOverdue(task, now)
    case 'today':
      return TaskDateCalculationService.isDueToday(task, now)
    case 'upcoming':
      return TaskDateCalculationService.isUpcoming(task, now)
  }
}

function sortTasks(source: Task[], _now: Date) {
  return [...source].sort((a, b) => {
    const statusDiff = Number(a.status === 'done') - Number(b.status === 'done')
    if (statusDiff !== 0) return statusDiff

    const priorityDiff = priorityRank(a.priority) - priorityRank(b.priority)
    if (priorityDiff !== 0) return priorityDiff

    const dueDiff = dueSortValue(a) - dueSortValue(b)
    if (dueDiff !== 0) return dueDiff

    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })
}

function priorityRank(priority: TaskPriority) {
  switch (priority) {
    case 'high':
      return 0
    case 'medium':
      return 1
    case 'low':
      return 2
    case 'none':
      return 3
  }
}

function dueSortValue(task: Task) {
  const start = taskStartDate(task)
  const end = taskEndDate(task)
  const date = start ?? end
  if (!date) return Number.MAX_SAFE_INTEGER
  return date.getTime()
}

function isOverdue(task: Task, now: Date) {
  const end = taskEndDate(task)
  if (!end) return false
  return startOfDay(end).getTime() < startOfDay(now).getTime()
}

function isDueToday(task: Task, now: Date) {
  const start = taskStartDate(task)
  const end = taskEndDate(task)
  const todayMs = startOfDay(now).getTime()
  if (start && end) {
    return startOfDay(start).getTime() <= todayMs && todayMs <= startOfDay(end).getTime()
  }
  if (start) return isSameDay(start, now)
  if (end) return isSameDay(end, now)
  return false
}

function isUpcoming(task: Task, now: Date) {
  const start = taskStartDate(task)
  const end = taskEndDate(task)
  const todayEnd = endOfDay(now).getTime()
  if (start) return start.getTime() > todayEnd
  if (end) return end.getTime() > todayEnd
  return false
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function endOfDay(date: Date) {
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d
}

function startOfDay(date: Date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function getDueBadge(task: Task) {
  const start = taskStartDate(task)
  const end = taskEndDate(task)
  if (!start && !end) return ''
  if (start && end) {
    const from = start.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
    const to = end.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
    return `${from} - ${to}`
  }
  const single = start ?? end
  if (!single) return ''
  return single.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
}

function priorityLabel(priority: TaskPriority) {
  switch (priority) {
    case 'high':
      return '優先度: 高'
    case 'medium':
      return '優先度: 中'
    case 'low':
      return '優先度: 低'
    case 'none':
      return '優先度: 未設定'
  }
}

function isoFromDateInputValue(value: string) {
  if (!value) return null
  const [yearStr, monthStr, dayStr] = value.split('-')
  const year = Number(yearStr)
  const month = Number(monthStr)
  const day = Number(dayStr)
  if (!year || !month || !day) return null
  // Use local noon to avoid timezone date shifts when converting to ISO.
  const local = new Date(year, month - 1, day, 12, 0, 0, 0)
  return Number.isNaN(local.getTime()) ? null : local.toISOString()
}

function localDateKey(date: Date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function localDateStartMsFromKey(key: string) {
  const [yearStr, monthStr, dayStr] = key.split('-')
  const date = new Date(Number(yearStr), Number(monthStr) - 1, Number(dayStr), 0, 0, 0, 0)
  return date.getTime()
}

function formatDateBoxLabel(key: string, now: Date) {
  const target = new Date(localDateStartMsFromKey(key))
  const base = target.toLocaleDateString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
  })
  if (isSameDay(target, now)) return `${base} (今日)`
  return base
}

function taskStartDate(task: Task) {
  if (!task.startAt) return null
  const d = new Date(task.startAt)
  return Number.isNaN(d.getTime()) ? null : d
}

function taskEndDate(task: Task) {
  if (!task.dueAt) return null
  const d = new Date(task.dueAt)
  return Number.isNaN(d.getTime()) ? null : d
}

function toDateInputValue(iso: string | null) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return localDateKey(date)
}

function formatDatePickerDisplayText(dateInputValue: string, emptyLabel: string) {
  if (!dateInputValue) return emptyLabel
  const [yearStr, monthStr, dayStr] = dateInputValue.split('-')
  const year = Number(yearStr)
  const month = Number(monthStr)
  const day = Number(dayStr)
  if (!year || !month || !day) return emptyLabel

  const localDate = new Date(year, month - 1, day, 12, 0, 0, 0)
  if (Number.isNaN(localDate.getTime())) return emptyLabel

  return localDate.toLocaleDateString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  })
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
