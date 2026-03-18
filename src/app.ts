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

type DateBoxGroup = {
  key: string
  label: string
  openItems: Task[]
  doneItems: Task[]
}

type TodayGroups = {
  overdueOpen: Task[]
  overdueDone: Task[]
  todayOpen: Task[]
  todayDone: Task[]
  pinnedOpen: Task[]
  pinnedDone: Task[]
  openCount: number
}

const STORAGE_KEY = 'todo-app-mvp-v1'
const UNDO_MS = 5000

// localStorage から読み込むデータを安全なアプリ状態へ整形する。
class TaskInputValidationService {
  // 1件ぶんのタスクデータを検証し、欠損があれば安全な既定値で補う。
  public static sanitizeTask(input: unknown): Task | null {
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

  // UI状態は入力途中の値を持つため、永続化してよい項目だけを復元する。
  public static sanitizeUi(input: Partial<UiState>): Partial<UiState> {
    return {
      showCompletedToday: Boolean(input.showCompletedToday),
      showCompletedInbox: Boolean(input.showCompletedInbox),
      allSearch: typeof input.allSearch === 'string' ? input.allSearch : '',
      allCompletion: input.allCompletion === 'all' ? 'all' : 'open',
      allPriority:
        input.allPriority === 'all' || TaskInputValidationService.isPriority(input.allPriority)
          ? input.allPriority
          : 'all',
      allDue: TaskInputValidationService.isDueFilter(input.allDue) ? input.allDue : 'all',
      deleteConfirm: typeof input.deleteConfirm === 'boolean' ? input.deleteConfirm : true,
      newTaskTitle: '',
      newTaskDueDate: typeof input.newTaskDueDate === 'string' ? input.newTaskDueDate : '',
      newTaskStartDate: typeof input.newTaskStartDate === 'string' ? input.newTaskStartDate : '',
      newTaskPriority: TaskInputValidationService.isPriority(input.newTaskPriority) ? input.newTaskPriority : 'none',
      notificationsEnabled: typeof input.notificationsEnabled === 'boolean' ? input.notificationsEnabled : false,
      lastTodayNotificationDate:
        typeof input.lastTodayNotificationDate === 'string' ? input.lastTodayNotificationDate : '',
    }
  }

  // 優先度の文字列が許可された値かどうかを判定する。
  public static isPriority(value: unknown): value is TaskPriority {
    return value === 'none' || value === 'low' || value === 'medium' || value === 'high'
  }

  // 期限フィルターの文字列が許可された値かどうかを判定する。
  public static isDueFilter(value: unknown): value is DueFilter {
    return value === 'all' || value === 'none' || value === 'has' || value === 'overdue' || value === 'today' || value === 'upcoming'
  }
}

// 日付まわりの比較、表示用変換、ネイティブ日付ピッカー操作をまとめる。
class TaskDateCalculationService {
  // 締切日が今日より前なら「遅れ」とみなす。
  public static isOverdue(task: Task, now: Date) {
    const end = TaskDateCalculationService.taskEndDate(task)
    if (!end) return false
    return TaskDateCalculationService.startOfDay(end).getTime() < TaskDateCalculationService.startOfDay(now).getTime()
  }

  // 開始日または締切日が今日にかかっているかを判定する。
  public static isDueToday(task: Task, now: Date) {
    const start = TaskDateCalculationService.taskStartDate(task)
    const end = TaskDateCalculationService.taskEndDate(task)
    const todayMs = TaskDateCalculationService.startOfDay(now).getTime()
    if (start && end) {
      return (
        TaskDateCalculationService.startOfDay(start).getTime() <= todayMs &&
        todayMs <= TaskDateCalculationService.startOfDay(end).getTime()
      )
    }
    if (start) return TaskDateCalculationService.isSameDay(start, now)
    if (end) return TaskDateCalculationService.isSameDay(end, now)
    return false
  }

  // 今日より未来に開始・締切があるタスクを「今後」とみなす。
  public static isUpcoming(task: Task, now: Date) {
    const start = TaskDateCalculationService.taskStartDate(task)
    const end = TaskDateCalculationService.taskEndDate(task)
    const todayEnd = TaskDateCalculationService.endOfDay(now).getTime()
    if (start) return start.getTime() > todayEnd
    if (end) return end.getTime() > todayEnd
    return false
  }

  // タスク一覧に表示する日付ラベルを組み立てる。
  public static getDueBadge(task: Task) {
    const start = TaskDateCalculationService.taskStartDate(task)
    const end = TaskDateCalculationService.taskEndDate(task)
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

  // input[type="date"] の値をタイムゾーンずれしにくい ISO 文字列へ変換する。
  public static isoFromDateInputValue(value: string) {
    if (!value) return null
    const [yearStr, monthStr, dayStr] = value.split('-')
    const year = Number(yearStr)
    const month = Number(monthStr)
    const day = Number(dayStr)
    if (!year || !month || !day) return null
    const local = new Date(year, month - 1, day, 12, 0, 0, 0)
    return Number.isNaN(local.getTime()) ? null : local.toISOString()
  }

  // ISO文字列を input[type="date"] に戻せる YYYY-MM-DD に変換する。
  public static toDateInputValue(iso: string | null) {
    if (!iso) return ''
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return ''
    return TaskDateCalculationService.localDateKey(date)
  }

  // 日付ピッカーのボタン表示用に、人間が読みやすい日付文字列へ整形する。
  public static formatDatePickerDisplayText(dateInputValue: string) {
    if (!dateInputValue) return ''
    const [yearStr, monthStr, dayStr] = dateInputValue.split('-')
    const year = Number(yearStr)
    const month = Number(monthStr)
    const day = Number(dayStr)
    if (!year || !month || !day) return ''

    const localDate = new Date(year, month - 1, day, 12, 0, 0, 0)
    if (Number.isNaN(localDate.getTime())) return ''

    return localDate.toLocaleDateString('ja-JP', {
      month: 'numeric',
      day: 'numeric',
      weekday: 'short',
    })
  }

  // ブラウザが対応していれば showPicker を使い、未対応なら focus/click で開く。
  public static openNativeDatePicker(input: HTMLInputElement) {
    const inputWithShowPicker = input as HTMLInputElement & { showPicker?: () => void }
    if (typeof inputWithShowPicker.showPicker === 'function') {
      inputWithShowPicker.showPicker()
      return
    }

    input.focus()
    input.click()
  }

  // 日付をローカルタイム基準の YYYY-MM-DD キーへ変換する。
  public static localDateKey(date: Date) {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  // YYYY-MM-DD キーをその日の 00:00 のタイムスタンプへ戻す。
  public static localDateStartMsFromKey(key: string) {
    const [yearStr, monthStr, dayStr] = key.split('-')
    const date = new Date(Number(yearStr), Number(monthStr) - 1, Number(dayStr), 0, 0, 0, 0)
    return date.getTime()
  }

  // 日付ボックスの見出しラベルを作る。今日なら注記を付ける。
  public static formatDateBoxLabel(key: string, now: Date) {
    const target = new Date(TaskDateCalculationService.localDateStartMsFromKey(key))
    const base = target.toLocaleDateString('ja-JP', {
      month: 'numeric',
      day: 'numeric',
    })
    if (TaskDateCalculationService.isSameDay(target, now)) return `${base} (今日)`
    return base
  }

  // 開始日の ISO 文字列を Date に変換する。
  public static taskStartDate(task: Task) {
    if (!task.startAt) return null
    const d = new Date(task.startAt)
    return Number.isNaN(d.getTime()) ? null : d
  }

  // 締切日の ISO 文字列を Date に変換する。
  public static taskEndDate(task: Task) {
    if (!task.dueAt) return null
    const d = new Date(task.dueAt)
    return Number.isNaN(d.getTime()) ? null : d
  }

  private static isSameDay(a: Date, b: Date) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  }

  private static endOfDay(date: Date) {
    const d = new Date(date)
    d.setHours(23, 59, 59, 999)
    return d
  }

  private static startOfDay(date: Date) {
    const d = new Date(date)
    d.setHours(0, 0, 0, 0)
    return d
  }
}

// タスクの並び替えや、各ビュー向けの抽出ロジックをまとめる。
class TaskQueryService {
  // 表示順は未完了優先 → 優先度順 → 日付順 → 新しい作成順。
  public static sortTasks(source: Task[], _now: Date) {
    return [...source].sort((a, b) => {
      const statusDiff = Number(a.status === 'done') - Number(b.status === 'done')
      if (statusDiff !== 0) return statusDiff

      const priorityDiff = TaskQueryService.priorityRank(a.priority) - TaskQueryService.priorityRank(b.priority)
      if (priorityDiff !== 0) return priorityDiff

      const dueDiff = TaskQueryService.dueSortValue(a) - TaskQueryService.dueSortValue(b)
      if (dueDiff !== 0) return dueDiff

      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })
  }

  // 今日ビュー用に「遅れ」「今日期限」「今日にピン留め」へ振り分ける。
  public static getTodayGroups(source: Task[], now: Date): TodayGroups {
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
    const pinnedDone = TaskQueryService.sortTasks(
      done.filter((task) => !seenDone.has(task.id) && task.pinnedForToday),
      now,
    )

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

  // 日付ボックス表示用に日付単位でタスクをまとめる。
  public static getDateBoxGroups(source: Task[], now: Date): DateBoxGroup[] {
    const map = new Map<string, { dateMs: number | null; openItems: Task[]; doneItems: Task[] }>()

    for (const task of source) {
      const start = TaskDateCalculationService.taskStartDate(task)
      const end = TaskDateCalculationService.taskEndDate(task)

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

      const anchor = start ?? end
      if (!anchor) continue

      const key = TaskDateCalculationService.localDateKey(anchor)
      const bucket = map.get(key) ?? {
        dateMs: TaskDateCalculationService.localDateStartMsFromKey(key),
        openItems: [],
        doneItems: [],
      }

      if (task.status === 'done') bucket.doneItems.push(task)
      else bucket.openItems.push(task)
      map.set(key, bucket)
    }

    const groups = [...map.entries()].map(([key, bucket]) => ({
      key,
      label: key === 'unscheduled' ? '日付未設定' : TaskDateCalculationService.formatDateBoxLabel(key, now),
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

  // すべてビューの検索条件を順に適用し、表示対象タスクを返す。
  public static getAllViewTasks(source: Task[], currentUi: UiState, now: Date) {
    const query = currentUi.allSearch.trim().toLowerCase()
    const filtered = source.filter((task) => {
      if (currentUi.allCompletion === 'open' && task.status === 'done') return false
      if (currentUi.allPriority !== 'all' && task.priority !== currentUi.allPriority) return false
      if (!TaskQueryService.matchesDueFilter(task, currentUi.allDue, now)) return false
      if (query) {
        const haystack = `${task.title} ${task.note}`.toLowerCase()
        if (!haystack.includes(query)) return false
      }
      return true
    })

    return TaskQueryService.sortTasks(filtered, now)
  }

  // 締切フィルターごとに、対象タスクかどうかを判定する。
  private static matchesDueFilter(task: Task, dueFilter: DueFilter, now: Date) {
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

  private static priorityRank(priority: TaskPriority) {
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

  // 並び替え用に、開始日または締切日の時刻を数値化する。
  private static dueSortValue(task: Task) {
    const start = TaskDateCalculationService.taskStartDate(task)
    const end = TaskDateCalculationService.taskEndDate(task)
    const date = start ?? end
    if (!date) return Number.MAX_SAFE_INTEGER
    return date.getTime()
  }
}

// UI文字列の整形と HTML エスケープを担当する。
class TaskTextPresentationService {
  // 優先度をラベル表示用テキストへ変換する。
  public static priorityLabel(priority: TaskPriority) {
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

  // ユーザー入力を HTML へ埋め込む前にエスケープして XSS を防ぐ。
  public static escapeHtml(value: string) {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;')
  }
}

// ブラウザ通知の権限確認、スケジューリング、送信処理を管理する。
class NotificationService {
  private timerId: number | null = null
  private readonly getTasks: () => Task[]
  private readonly getUi: () => UiState
  private readonly setUi: (patch: Partial<UiState>) => void

  public constructor(getTasks: () => Task[], getUi: () => UiState, setUi: (patch: Partial<UiState>) => void) {
    this.getTasks = getTasks
    this.getUi = getUi
    this.setUi = setUi
  }

  // 1分ごとに今日の通知対象があるかを確認する。
  public startScheduler() {
    if (this.timerId !== null) {
      window.clearInterval(this.timerId)
    }

    this.timerId = window.setInterval(() => {
      this.maybeNotifyTodayTasks()
    }, 60_000)
  }

  // ブラウザが Notification API を使えるかどうかを判定する。
  public isSupported() {
    return typeof window !== 'undefined' && 'Notification' in window
  }

  // 通知権限の現在値を返す。未対応ブラウザは独自値で扱う。
  public getPermission(): NotificationPermission | 'unsupported' {
    if (!this.isSupported()) return 'unsupported'
    return Notification.permission
  }

  // 今日の未完了タスクがあれば1日1回だけデスクトップ通知を出す。
  public maybeNotifyTodayTasks() {
    const ui = this.getUi()
    if (!ui.notificationsEnabled) return
    if (this.getPermission() !== 'granted') return

    const now = new Date()
    const todayKey = TaskDateCalculationService.localDateKey(now)
    if (ui.lastTodayNotificationDate === todayKey) return

    const effectiveTodayTasks = this.getTasks().filter(
      (task) => task.status === 'open' && TaskDateCalculationService.isDueToday(task, now),
    )
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
      this.setUi({ lastTodayNotificationDate: todayKey })
    } catch {
      // Ignore notification runtime errors.
    }
  }

  // ブラウザに通知権限ダイアログを表示し、許可後は必要なら即通知する。
  public async requestPermission() {
    if (!this.isSupported()) return
    try {
      const result = await Notification.requestPermission()
      if (result === 'granted' && this.getUi().notificationsEnabled) {
        this.maybeNotifyTodayTasks()
      }
    } catch {
      // Ignore permission prompt failures.
    }
  }
}

// アプリ全体の状態、描画、イベント配線を管理するメインクラス。
export class TodoTaskApplication {
  private readonly app: HTMLDivElement
  private readonly notificationService: NotificationService
  private tasks: Task[] = []
  private ui: UiState = {
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
  private undoAction: UndoAction | null = null

  public constructor() {
    const app = document.querySelector<HTMLDivElement>('#app')
    if (!app) {
      throw new Error('#app not found')
    }
    this.app = app

    this.notificationService = new NotificationService(
      () => this.tasks,
      () => this.ui,
      (patch) => this.setUi(patch),
    )
  }

  // 起動時に保存データの復元、初回描画、グローバルイベント登録を行う。
  public start() {
    this.loadState()
    this.render()
    document.addEventListener('keydown', this.onGlobalKeyDown)
    document.addEventListener('visibilitychange', this.onVisibilityChange)
    this.notificationService.startScheduler()
  }

  // localStorage から前回状態を読み込み、壊れたデータは無視する。
  private loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return

      const parsed = JSON.parse(raw) as { tasks?: unknown; ui?: Partial<UiState> }
      if (Array.isArray(parsed.tasks)) {
        this.tasks = parsed.tasks
          .map((task) => TaskInputValidationService.sanitizeTask(task))
          .filter((task): task is Task => task !== null)
      }

      if (parsed.ui && typeof parsed.ui === 'object') {
        this.ui = {
          ...this.ui,
          ...TaskInputValidationService.sanitizeUi(parsed.ui),
        }
      }
    } catch {
      // Ignore broken local state and start fresh.
    }
  }

  // 現在のタスク一覧とUI状態を localStorage へ保存する。
  private saveState() {
    const payload = {
      tasks: this.tasks,
      ui: {
        ...this.ui,
        newTaskTitle: '',
        newTaskDueDate: '',
        newTaskStartDate: '',
        newTaskPriority: 'none',
      },
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  }

  // UI状態を部分更新し、必要なら保存と再描画を行う。
  private setUi(patch: Partial<UiState>, options?: { skipRender?: boolean }) {
    this.ui = { ...this.ui, ...patch }
    this.saveState()
    if (!options?.skipRender) {
      this.render()
    }
  }

  // タスク一覧を丸ごと差し替え、保存と再描画をまとめて行う。
  private setTasks(next: Task[], options?: { skipRender?: boolean }) {
    this.tasks = next
    this.saveState()
    if (!options?.skipRender) {
      this.render()
    }
  }

  // 1件のタスクを部分更新し、更新日時も自動で更新する。
  private updateTask(taskId: string, patch: Partial<Task>) {
    const nowIso = new Date().toISOString()
    this.setTasks(
      this.tasks.map((task) =>
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

  // 削除確認のうえでタスクを削除し、Undo 用の復元処理も登録する。
  private removeTask(taskId: string) {
    const index = this.tasks.findIndex((task) => task.id === taskId)
    if (index < 0) return

    const task = this.tasks[index]
    if (this.ui.deleteConfirm && !window.confirm(`「${task.title}」を削除しますか？`)) {
      return
    }

    const next = this.tasks.filter((item) => item.id !== taskId)
    this.setUndo({
      label: 'タスクを削除しました',
      run: () => {
        const restored = [...this.tasks]
        if (restored.some((item) => item.id === task.id)) return
        restored.splice(index, 0, task)
        this.tasks = restored
        this.saveState()
        this.render()
      },
    })
    this.setTasks(next)
  }

  // 一時的に戻せる操作を登録し、Undo バー表示を更新する。
  private setUndo(action: Omit<UndoAction, 'expiresAt'>) {
    this.undoAction = {
      ...action,
      expiresAt: Date.now() + UNDO_MS,
    }
    this.render()
  }

  // Undo の有効期限を過ぎていたら表示対象から外す。
  private clearUndoIfExpired() {
    if (this.undoAction && Date.now() > this.undoAction.expiresAt) {
      this.undoAction = null
    }
  }

  // 登録済みの Undo 処理を1回だけ実行する。
  private runUndo() {
    if (!this.undoAction) return
    const action = this.undoAction
    this.undoAction = null
    action.run()
  }

  // クイック追加欄の値から新しいタスクを生成して一覧へ追加する。
  private createTaskFromInput() {
    const taskTitleInput = this.app.querySelector<HTMLInputElement>('#task-title-input')
    const taskStartDateInput = this.app.querySelector<HTMLInputElement>('#task-start-date-input')
    const taskPrioritySelect = this.app.querySelector<HTMLSelectElement>('#task-priority-select')

    if (taskTitleInput) {
      this.ui.newTaskTitle = taskTitleInput.value
    }
    if (taskStartDateInput) {
      this.ui.newTaskStartDate = taskStartDateInput.value
    }
    if (taskPrioritySelect) {
      const selectedPriority = taskPrioritySelect.value
      this.ui.newTaskPriority = TaskInputValidationService.isPriority(selectedPriority) ? selectedPriority : 'none'
    }

    // タイトルが空なら追加せず、その場でエラーメッセージを表示する。
    const title = this.ui.newTaskTitle.trim()
    if (!title) {
      this.render({ addError: 'タイトルを入力してください。' })
      taskTitleInput?.focus()
      return
    }

    const nowIso = new Date().toISOString()
    const task: Task = {
      id: crypto.randomUUID(),
      title,
      status: 'open',
      startAt: TaskDateCalculationService.isoFromDateInputValue(this.ui.newTaskStartDate),
      dueAt: null,
      priority: this.ui.newTaskPriority,
      note: '',
      createdAt: nowIso,
      updatedAt: nowIso,
      pinnedForToday: false,
      inInbox: false,
    }

    // 新規タスクは先頭へ追加し、今日タスクなら今日ビューへ遷移する。
    const savedTasks = [task, ...this.tasks]
    const shouldOpenTodayView = TaskDateCalculationService.isDueToday(task, new Date())

    this.tasks = savedTasks
    this.ui = {
      ...this.ui,
      view: shouldOpenTodayView ? 'today' : 'inbox',
      newTaskTitle: '',
      newTaskStartDate: '',
      newTaskPriority: 'none',
    }
    this.saveState()
    this.render()
    this.app.querySelector<HTMLInputElement>('#task-title-input')?.focus()
  }

  // 完了・未完了の切り替えに Undo を付けて状態を更新する。
  private toggleTaskCompletion(taskId: string, nextStatus: TaskStatus) {
    const original = this.tasks.find((task) => task.id === taskId)
    if (!original || original.status === nextStatus) return

    this.setUndo({
      label: nextStatus === 'done' ? 'タスクを完了しました' : '未完了に戻しました',
      run: () => {
        this.updateTask(taskId, { status: original.status })
      },
    })

    this.updateTask(taskId, { status: nextStatus })
  }

  // グローバルショートカットを処理する。/ は検索、Cmd/Ctrl+Z は Undo。
  private onGlobalKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null
    const tagName = target?.tagName
    const isTypingTarget = tagName === 'INPUT' || tagName === 'TEXTAREA' || target?.isContentEditable

    if (event.key === '/' && !isTypingTarget) {
      event.preventDefault()
      this.ui.view = 'all'
      this.saveState()
      this.render()
      this.app.querySelector<HTMLInputElement>('#all-search')?.focus()
      return
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && this.undoAction) {
      event.preventDefault()
      this.runUndo()
    }
  }

  // タブが前面に戻ったとき、今日の通知が必要なら再判定する。
  private onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      this.notificationService.maybeNotifyTodayTasks()
    }
  }

  // 現在の状態から HTML を組み立て、画面全体を再描画する。
  private render(options?: { addError?: string }) {
    this.clearUndoIfExpired()

    // まず描画に必要な各ビュー向けデータをまとめて作る。
    const now = new Date()
    const todayGroups = TaskQueryService.getTodayGroups(this.tasks, now)
    const dateBoxTasks = TaskQueryService.sortTasks(this.tasks, now)
    const allViewTasks = TaskQueryService.getAllViewTasks(this.tasks, this.ui, now)

    const shellTemplate = document.querySelector<HTMLTemplateElement>('#application-layout-template')
    if (!shellTemplate) {
      throw new Error('#application-layout-template not found')
    }

    // シェルをテンプレートから差し込み、その後に各領域を埋める。
    this.app.replaceChildren(shellTemplate.content.cloneNode(true))

    const navigationRoot = this.app.querySelector<HTMLElement>('#primary-navigation')
    const taskTitleInput = this.app.querySelector<HTMLInputElement>('#task-title-input')
    const taskStartDateInput = this.app.querySelector<HTMLInputElement>('#task-start-date-input')
    const taskStartDateLabel = this.app.querySelector<HTMLElement>('#task-start-date-label')
    const taskPrioritySelect = this.app.querySelector<HTMLSelectElement>('#task-priority-select')
    const deleteConfirmationToggle = this.app.querySelector<HTMLInputElement>('#delete-confirmation-toggle')
    const notificationSettingsArea = this.app.querySelector<HTMLElement>('#notification-settings-area')
    const taskEntryErrorArea = this.app.querySelector<HTMLElement>('#task-entry-error-area')
    const taskViewSection = this.app.querySelector<HTMLElement>('#task-view-section')
    const undoNoticeArea = this.app.querySelector<HTMLElement>('#undo-notice-area')

    if (
      !navigationRoot ||
      !taskTitleInput ||
      !taskStartDateInput ||
      !taskStartDateLabel ||
      !taskPrioritySelect ||
      !deleteConfirmationToggle ||
      !notificationSettingsArea ||
      !taskEntryErrorArea ||
      !taskViewSection ||
      !undoNoticeArea
    ) {
      throw new Error('render roots not found')
    }

    // ナビゲーション、入力欄、メインビュー、Undo バーを現在状態で更新する。
    navigationRoot.replaceChildren(
      this.renderNavButton('today', '今日', todayGroups.openCount),
      this.renderNavButton('inbox', '日付ボックス', dateBoxTasks.filter((task) => task.status === 'open').length),
      this.renderNavButton('all', 'すべて', this.tasks.length),
    )

    taskTitleInput.value = this.ui.newTaskTitle
    taskStartDateInput.value = this.ui.newTaskStartDate
    taskStartDateLabel.textContent = TaskDateCalculationService.formatDatePickerDisplayText(this.ui.newTaskStartDate)
    taskPrioritySelect.value = this.ui.newTaskPriority
    taskTitleInput.setAttribute('aria-describedby', options?.addError ? 'task-entry-help task-entry-error' : 'task-entry-help')
    deleteConfirmationToggle.checked = this.ui.deleteConfirm
    notificationSettingsArea.replaceChildren()
    const notificationSettings = this.renderNotificationSettings()
    if (notificationSettings) {
      notificationSettingsArea.append(notificationSettings)
    }

    taskEntryErrorArea.replaceChildren()
    if (options?.addError) {
      const errorMessage = this.cloneTemplateElement<HTMLParagraphElement>('#task-entry-error-template')
      const errorMessageSlot = errorMessage.querySelector<HTMLElement>('[data-slot="message"]')
      if (!errorMessageSlot) {
        throw new Error('quick add error message slot not found')
      }
      errorMessageSlot.textContent = options.addError
      taskEntryErrorArea.append(errorMessage)
    }

    const activeView =
      this.ui.view === 'today'
        ? this.renderTodayView(todayGroups)
        : this.ui.view === 'inbox'
          ? this.renderDateBoxView(dateBoxTasks, now)
          : this.renderAllView(allViewTasks)
    taskViewSection.replaceChildren(activeView)

    undoNoticeArea.replaceChildren()
    const undoBar = this.renderUndoBar()
    if (undoBar) {
      undoNoticeArea.append(undoBar)
    }

    // 再描画で DOM が入れ替わるため、イベントは毎回バインドし直す。
    this.bindEvents()
    this.notificationService.maybeNotifyTodayTasks()
  }

  // 左ナビの各タブボタンを描画する。
  private renderNavButton(view: ViewKey, label: string, count: number) {
    const button = this.cloneTemplateElement<HTMLButtonElement>('#view-navigation-button-template')
    const labelSlot = button.querySelector<HTMLElement>('[data-slot="label"]')
    const countSlot = button.querySelector<HTMLElement>('[data-slot="count"]')
    if (!labelSlot || !countSlot) {
      throw new Error('nav button slots not found')
    }

    button.classList.toggle('is-active', this.ui.view === view)
    button.dataset.view = view
    button.setAttribute('aria-current', this.ui.view === view ? 'page' : 'false')
    labelSlot.textContent = label
    countSlot.textContent = String(count)
    return button
  }

  // 今日ビュー全体を描画する。
  private renderTodayView(groups: TodayGroups) {
    const panel = this.cloneTemplateElement<HTMLElement>('#today-task-view-template')
    const toggle = panel.querySelector<HTMLInputElement>('[data-action="toggle-show-completed-today"]')
    const sectionsSlot = panel.querySelector<HTMLElement>('[data-slot="sections"]')
    const emptyMessage = panel.querySelector<HTMLElement>('[data-slot="empty-message"]')
    if (!toggle || !sectionsSlot || !emptyMessage) {
      throw new Error('today view slots not found')
    }

    toggle.checked = this.ui.showCompletedToday
    sectionsSlot.replaceChildren(
      this.renderTodaySection('遅れ', groups.overdueOpen, groups.overdueDone, this.ui.showCompletedToday),
      this.renderTodaySection('今日期限', groups.todayOpen, groups.todayDone, this.ui.showCompletedToday),
      this.renderTodaySection('今日にピン留め', groups.pinnedOpen, groups.pinnedDone, this.ui.showCompletedToday),
    )
    emptyMessage.hidden = groups.openCount !== 0
    return panel
  }

  // 今日ビュー内の1セクションを描画する。
  private renderTodaySection(title: string, openItems: Task[], doneItems: Task[], showCompleted: boolean) {
    const visibleDone = showCompleted ? doneItems : []
    const section = this.cloneTemplateElement<HTMLElement>('#today-task-section-template')
    const titleSlot = section.querySelector<HTMLElement>('[data-slot="title"]')
    const list = section.querySelector<HTMLUListElement>('[data-slot="task-list"]')
    const emptyMessage = section.querySelector<HTMLElement>('[data-slot="empty-message"]')
    if (!titleSlot || !list || !emptyMessage) {
      throw new Error('today section slots not found')
    }

    titleSlot.textContent = title
    list.setAttribute('aria-label', title)
    const items = [...openItems, ...visibleDone].map((task) => this.renderTaskItem(task))
    list.replaceChildren(...items)
    list.hidden = items.length === 0
    emptyMessage.hidden = items.length !== 0
    return section
  }

  // 日付ボックスビュー全体を描画する。
  private renderDateBoxView(items: Task[], now: Date) {
    const groups = TaskQueryService.getDateBoxGroups(items, now)
    const hiddenDoneCount = this.ui.showCompletedInbox
      ? 0
      : items.filter((task) => task.status === 'done').length

    const panel = this.cloneTemplateElement<HTMLElement>('#date-box-task-view-template')
    const toggle = panel.querySelector<HTMLInputElement>('[data-action="toggle-show-completed-inbox"]')
    const groupsSlot = panel.querySelector<HTMLElement>('[data-slot="groups"]')
    const hiddenDone = panel.querySelector<HTMLElement>('[data-slot="hidden-done-count"]')
    if (!toggle || !groupsSlot || !hiddenDone) {
      throw new Error('inbox view slots not found')
    }

    toggle.checked = this.ui.showCompletedInbox
    this.renderDateBoxGroups(groupsSlot, groups, this.ui.showCompletedInbox)
    hiddenDone.hidden = hiddenDoneCount === 0
    hiddenDone.textContent = `${hiddenDoneCount}件の完了タスクを非表示中`
    return panel
  }

  // すべてビューと検索・フィルター UI を描画する。
  private renderAllView(items: Task[]) {
    const groups = TaskQueryService.getDateBoxGroups(items, new Date())
    const panel = this.cloneTemplateElement<HTMLElement>('#all-tasks-view-template')
    const countSlot = panel.querySelector<HTMLElement>('[data-slot="result-count"]')
    const searchInput = panel.querySelector<HTMLInputElement>('#all-search')
    const completionFilter = panel.querySelector<HTMLSelectElement>('#filter-completion')
    const priorityFilter = panel.querySelector<HTMLSelectElement>('#filter-priority')
    const dueFilter = panel.querySelector<HTMLSelectElement>('#filter-due')
    const groupsSlot = panel.querySelector<HTMLElement>('[data-slot="groups"]')
    if (!countSlot || !searchInput || !completionFilter || !priorityFilter || !dueFilter || !groupsSlot) {
      throw new Error('all view slots not found')
    }

    countSlot.textContent = `${items.length}件表示`
    searchInput.value = this.ui.allSearch
    completionFilter.value = this.ui.allCompletion
    priorityFilter.value = this.ui.allPriority
    dueFilter.value = this.ui.allDue
    this.renderDateBoxGroups(groupsSlot, groups, this.ui.allCompletion === 'all')
    return panel
  }

  // 1件ぶんのタスク行を描画する。
  private renderTaskItem(task: Task) {
    const dueBadge = TaskDateCalculationService.getDueBadge(task)
    const startInputValue = TaskDateCalculationService.toDateInputValue(task.startAt)
    const taskDatePickerDisplayText = TaskDateCalculationService.formatDatePickerDisplayText(startInputValue)
    const isDone = task.status === 'done'
    const item = this.cloneTemplateElement<HTMLLIElement>('#task-list-item-template')
    const completeToggle = item.querySelector<HTMLInputElement>('[data-action="toggle-complete"]')
    const titleInput = item.querySelector<HTMLInputElement>('[data-action="update-title"]')
    const priorityBadge = item.querySelector<HTMLElement>('[data-slot="priority-badge"]')
    const dueBadgeElement = item.querySelector<HTMLElement>('[data-slot="due-badge"]')
    const todayBadge = item.querySelector<HTMLElement>('[data-slot="today-badge"]')
    const pinButton = item.querySelector<HTMLButtonElement>('[data-action="pin-today"]')
    const dateOpenButton = item.querySelector<HTMLButtonElement>('[data-action="open-task-start-date-picker"]')
    const dateDisplay = item.querySelector<HTMLElement>('[data-slot="start-date-display"]')
    const dateInput = item.querySelector<HTMLInputElement>('[data-action="update-start-date"]')
    const prioritySelect = item.querySelector<HTMLSelectElement>('[data-action="update-priority"]')
    const completeButton = item.querySelector<HTMLButtonElement>('[data-action="toggle-complete-button"]')
    const deleteButton = item.querySelector<HTMLButtonElement>('[data-action="delete-task"]')
    const noteField = item.querySelector<HTMLTextAreaElement>('[data-action="update-note"]')
    if (
      !completeToggle ||
      !titleInput ||
      !priorityBadge ||
      !dueBadgeElement ||
      !todayBadge ||
      !pinButton ||
      !dateOpenButton ||
      !dateDisplay ||
      !dateInput ||
      !prioritySelect ||
      !completeButton ||
      !deleteButton ||
      !noteField
    ) {
      throw new Error('task item slots not found')
    }

    item.classList.toggle('is-done', isDone)
    completeToggle.dataset.taskId = task.id
    completeToggle.checked = isDone
    completeToggle.setAttribute('aria-label', `${isDone ? '未完了に戻す' : '完了にする'}: ${task.title}`)
    titleInput.dataset.taskId = task.id
    titleInput.value = task.title
    priorityBadge.textContent = TaskTextPresentationService.priorityLabel(task.priority)
    dueBadgeElement.textContent = dueBadge || '期限なし'
    dueBadgeElement.classList.toggle('muted', !dueBadge)
    todayBadge.hidden = !task.pinnedForToday
    pinButton.dataset.taskId = task.id
    pinButton.textContent = task.pinnedForToday ? '今日から外す' : '今日に入れる'
    dateOpenButton.dataset.taskId = task.id
    dateDisplay.textContent = taskDatePickerDisplayText
    dateInput.dataset.taskId = task.id
    dateInput.value = startInputValue
    prioritySelect.dataset.taskId = task.id
    prioritySelect.value = task.priority
    completeButton.dataset.taskId = task.id
    completeButton.textContent = isDone ? '未完了に戻す' : '完了'
    deleteButton.dataset.taskId = task.id
    noteField.dataset.taskId = task.id
    noteField.value = task.note
    return item
  }

  // Undo バーは有効な操作があるときだけ表示する。
  private renderUndoBar() {
    if (!this.undoAction) return null
    const remaining = Math.max(0, Math.ceil((this.undoAction.expiresAt - Date.now()) / 1000))
    const undoBar = this.cloneTemplateElement<HTMLElement>('#undo-notice-template')
    const labelSlot = undoBar.querySelector<HTMLElement>('[data-slot="label"]')
    const remainingSlot = undoBar.querySelector<HTMLElement>('[data-slot="remaining"]')
    if (!labelSlot || !remainingSlot) {
      throw new Error('undo bar slots not found')
    }

    labelSlot.textContent = this.undoAction.label
    remainingSlot.textContent = `${remaining}s`
    return undoBar
  }

  // 通知設定はデスクトップ向けだけ表示し、権限状態も併記する。
  private renderNotificationSettings() {
    const isMobileViewport =
      typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches
    if (isMobileViewport) return null

    const supported = this.notificationService.isSupported()
    const permission = this.notificationService.getPermission()
    const permissionLabel =
      !supported
        ? 'このブラウザは通知未対応'
        : permission === 'granted'
          ? '通知許可済み'
          : permission === 'denied'
            ? '通知が拒否されています'
            : '通知未許可'

    const settings = this.cloneTemplateElement<HTMLElement>('#notification-preferences-template')
    const toggle = settings.querySelector<HTMLInputElement>('#notifications-enabled-toggle')
    const hint = settings.querySelector<HTMLElement>('[data-slot="permission-label"]')
    const requestButton = settings.querySelector<HTMLButtonElement>('[data-action="request-notification-permission"]')
    if (!toggle || !hint || !requestButton) {
      throw new Error('notification settings slots not found')
    }

    toggle.checked = this.ui.notificationsEnabled
    toggle.disabled = !supported
    hint.textContent = permissionLabel
    requestButton.hidden = !(supported && permission !== 'granted')
    return settings
  }

  // 日付ごとのグループをまとめて描画する。
  private renderDateBoxGroups(container: HTMLElement, groups: DateBoxGroup[], showCompleted: boolean) {
    container.replaceChildren()
    if (groups.length === 0) {
      container.append(this.renderEmptyMessage('表示できるタスクがありません。'))
      return
    }

    groups.forEach((group) => {
      const visibleDone = showCompleted ? group.doneItems : []
      const totalCount = group.openItems.length + visibleDone.length
      if (totalCount === 0) return

      const box = this.cloneTemplateElement<HTMLElement>('#date-group-template')
      const titleSlot = box.querySelector<HTMLElement>('[data-slot="title"]')
      const countSlot = box.querySelector<HTMLElement>('[data-slot="count"]')
      const list = box.querySelector<HTMLUListElement>('[data-slot="task-list"]')
      if (!titleSlot || !countSlot || !list) {
        throw new Error('date box slots not found')
      }

      titleSlot.textContent = group.label
      countSlot.textContent = `${totalCount}件`
      list.setAttribute('aria-label', group.label)
      list.replaceChildren(...group.openItems.map((task) => this.renderTaskItem(task)), ...visibleDone.map((task) => this.renderTaskItem(task)))
      container.append(box)
    })
  }

  private renderEmptyMessage(label: string) {
    const message = this.cloneTemplateElement<HTMLParagraphElement>('#empty-state-message-template')
    message.textContent = label
    return message
  }

  private cloneTemplateElement<T extends Element>(templateId: string) {
    const template = document.querySelector<HTMLTemplateElement>(templateId)
    if (!template) {
      throw new Error(`${templateId} not found`)
    }

    const clonedNode = template.content.firstElementChild?.cloneNode(true)
    if (!(clonedNode instanceof Element)) {
      throw new Error(`${templateId} has no root element`)
    }

    return clonedNode as T
  }

  // 再描画後の DOM に対して、画面上の操作イベントをひも付ける。
  private bindEvents() {
    const taskEntryForm = this.app.querySelector<HTMLFormElement>('#task-entry-form')
    const taskTitleInput = this.app.querySelector<HTMLInputElement>('#task-title-input')
    const taskStartDateInput = this.app.querySelector<HTMLInputElement>('#task-start-date-input')
    const taskPrioritySelect = this.app.querySelector<HTMLSelectElement>('#task-priority-select')

    // クイック追加欄は入力途中でも保存しておき、リロード時に復元できるようにする。
    taskTitleInput?.addEventListener('input', (event) => {
      this.ui.newTaskTitle = (event.target as HTMLInputElement).value
      this.saveState()
    })

    taskPrioritySelect?.addEventListener('change', (event) => {
      const value = (event.target as HTMLSelectElement).value
      this.ui.newTaskPriority = TaskInputValidationService.isPriority(value) ? value : 'none'
      this.saveState()
    })

    taskStartDateInput?.addEventListener('change', (event) => {
      this.ui.newTaskStartDate = (event.target as HTMLInputElement).value
      const taskStartDateLabel = this.app.querySelector<HTMLElement>('#task-start-date-label')
      if (taskStartDateLabel) {
        taskStartDateLabel.textContent = TaskDateCalculationService.formatDatePickerDisplayText(this.ui.newTaskStartDate)
      }
      this.saveState()
    })

    taskEntryForm?.addEventListener('submit', (event) => {
      event.preventDefault()
      this.createTaskFromInput()
    })

    // data-action ごとに処理を振り分けることで、イベントの追加先を一本化する。
    this.app.querySelectorAll<HTMLElement>('[data-action]').forEach((element) => {
      const action = element.dataset.action
      if (
        !(
          element instanceof HTMLButtonElement ||
          element instanceof HTMLInputElement ||
          element instanceof HTMLSelectElement ||
          element instanceof HTMLTextAreaElement
        )
      ) {
        return
      }

      if (action === 'switch-view' && element instanceof HTMLButtonElement) {
        element.addEventListener('click', () => {
          const view = element.dataset.view as ViewKey | undefined
          if (!view) return
          this.setUi({ view })
        })
      }

      if (action === 'toggle-delete-confirm' && element instanceof HTMLInputElement) {
        element.addEventListener('change', () => this.setUi({ deleteConfirm: element.checked }))
      }

      if (action === 'open-task-entry-start-date-picker' && element instanceof HTMLButtonElement) {
        element.addEventListener('click', () => {
          if (!taskStartDateInput) return
          TaskDateCalculationService.openNativeDatePicker(taskStartDateInput)
        })
      }

      if (action === 'open-task-start-date-picker' && element instanceof HTMLButtonElement) {
        element.addEventListener('click', () => {
          const taskId = element.dataset.taskId
          if (!taskId) return

          const taskDateInput = this.app.querySelector<HTMLInputElement>(
            `input[data-action="update-start-date"][data-task-id="${taskId}"]`,
          )
          if (!taskDateInput) return

          TaskDateCalculationService.openNativeDatePicker(taskDateInput)
        })
      }

      if (action === 'toggle-notifications-enabled' && element instanceof HTMLInputElement) {
        element.addEventListener('change', () => {
          this.ui.notificationsEnabled = element.checked
          if (!element.checked) {
            this.saveState()
            this.render()
            return
          }

          const permission = this.notificationService.getPermission()
          if (permission === 'default') {
            this.saveState()
            void this.notificationService.requestPermission().then(() => this.render())
            return
          }

          this.saveState()
          this.render()
          this.notificationService.maybeNotifyTodayTasks()
        })
      }

      if (action === 'request-notification-permission' && element instanceof HTMLButtonElement) {
        element.addEventListener('click', () => {
          void this.notificationService.requestPermission().then(() => this.render())
        })
      }

      if (action === 'toggle-show-completed-today' && element instanceof HTMLInputElement) {
        element.addEventListener('change', () => this.setUi({ showCompletedToday: element.checked }))
      }

      if (action === 'toggle-show-completed-inbox' && element instanceof HTMLInputElement) {
        element.addEventListener('change', () => this.setUi({ showCompletedInbox: element.checked }))
      }

      if (action === 'toggle-complete' && element instanceof HTMLInputElement) {
        element.addEventListener('change', () => {
          const taskId = element.dataset.taskId
          if (!taskId) return
          this.toggleTaskCompletion(taskId, element.checked ? 'done' : 'open')
        })
      }

      if (action === 'toggle-complete-button' && element instanceof HTMLButtonElement) {
        element.addEventListener('click', () => {
          const taskId = element.dataset.taskId
          if (!taskId) return
          const task = this.tasks.find((item) => item.id === taskId)
          if (!task) return
          this.toggleTaskCompletion(taskId, task.status === 'done' ? 'open' : 'done')
        })
      }

      if (action === 'pin-today' && element instanceof HTMLButtonElement) {
        element.addEventListener('click', () => {
          const taskId = element.dataset.taskId
          if (!taskId) return
          const task = this.tasks.find((item) => item.id === taskId)
          if (!task) return
          this.updateTask(taskId, { pinnedForToday: !task.pinnedForToday })
        })
      }

      if (action === 'delete-task' && element instanceof HTMLButtonElement) {
        element.addEventListener('click', () => {
          const taskId = element.dataset.taskId
          if (!taskId) return
          this.removeTask(taskId)
        })
      }

      if (action === 'undo' && element instanceof HTMLButtonElement) {
        element.addEventListener('click', () => this.runUndo())
      }

      if (action === 'update-title' && element instanceof HTMLInputElement) {
        element.addEventListener('blur', () => {
          const taskId = element.dataset.taskId
          if (!taskId) return
          const title = element.value.trim()
          const current = this.tasks.find((task) => task.id === taskId)
          if (!current) return
          if (!title) {
            element.value = current.title
            return
          }
          if (title !== current.title) {
            this.updateTask(taskId, { title })
          }
        })
      }

      if (action === 'update-start-date' && element instanceof HTMLInputElement) {
        element.addEventListener('change', () => {
          const taskId = element.dataset.taskId
          if (!taskId) return
          const startAt = TaskDateCalculationService.isoFromDateInputValue(element.value)
          this.updateTask(taskId, { startAt, dueAt: null })
        })
      }

      if (action === 'update-priority' && element instanceof HTMLSelectElement) {
        element.addEventListener('change', () => {
          const taskId = element.dataset.taskId
          if (!taskId) return
          const priority = TaskInputValidationService.isPriority(element.value) ? element.value : 'none'
          this.updateTask(taskId, { priority })
        })
      }

      if (action === 'update-note' && element instanceof HTMLTextAreaElement) {
        element.addEventListener('blur', () => {
          const taskId = element.dataset.taskId
          if (!taskId) return
          this.updateTask(taskId, { note: element.value })
        })
      }
    })

    // すべてビューのフィルターは変更のたびに即時反映する。
    const allSearch = this.app.querySelector<HTMLInputElement>('#all-search')
    allSearch?.addEventListener('input', () => {
      this.ui = { ...this.ui, allSearch: allSearch.value }
      this.saveState()
      this.render()
      this.app.querySelector<HTMLInputElement>('#all-search')?.focus()
    })

    this.app.querySelector<HTMLSelectElement>('#filter-completion')?.addEventListener('change', (event) => {
      const value = (event.target as HTMLSelectElement).value === 'all' ? 'all' : 'open'
      this.setUi({ allCompletion: value })
    })

    this.app.querySelector<HTMLSelectElement>('#filter-priority')?.addEventListener('change', (event) => {
      const value = (event.target as HTMLSelectElement).value
      this.setUi({
        allPriority: value === 'all' || TaskInputValidationService.isPriority(value) ? value : 'all',
      })
    })

    this.app.querySelector<HTMLSelectElement>('#filter-due')?.addEventListener('change', (event) => {
      const value = (event.target as HTMLSelectElement).value
      this.setUi({
        allDue: TaskInputValidationService.isDueFilter(value) ? value : 'all',
      })
    })

    // Undo バーの残り秒数を更新するため、表示中は1秒ごとに再描画する。
    if (this.undoAction) {
      window.setTimeout(() => {
        if (this.undoAction && Date.now() > this.undoAction.expiresAt) {
          this.undoAction = null
          this.render()
        } else if (this.undoAction) {
          this.render()
        }
      }, 1000)
    }
  }
}
