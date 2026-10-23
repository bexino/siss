/**
 * 在线排班系统 - 交互与状态控制模块
 */

// 界面控件隐藏判定：网址参数 hide=theme,footer（半角逗号分隔），隐藏主题切换按钮与页脚；
// 对应功能（theme 参数本身）仍按地址栏参数生效，仅不显示切换按钮；对导出 PDF 无影响
window.APP_HIDE = (() => {
  const raw = new URLSearchParams(location.search).get('hide') || '';
  const valid = new Set(['theme', 'footer']);
  return new Set(raw.split(',').map(s => s.trim().toLowerCase()).filter(s => valid.has(s)));
})();

// 预设示例人员名单 ：中文模式为中文译名，英文模式为英文原名
const SAMPLE_NAMES_TEXT = `诺里斯, 皮亚斯特里, 拉塞尔, 安东内利, 勒克莱尔, 汉密尔顿, 维斯塔潘, 哈贾尔, 阿隆索, 斯特罗尔, 阿尔本, 塞恩斯, 比尔曼, 奥康, 加斯利, 科拉平托, 劳森, 林德布拉德, 霍肯伯格, 博托莱托, 佩雷斯, 博塔斯`;

// 顺延自旧排班表：载入示例的 Markdown 文本（相对日期标题，导入时从当天起算）
const SAMPLE_ROSTER_MD_ZH = `## 2026-10-19，周一
哈贾尔，斯特罗尔，勒克莱尔，塞恩斯

## 2026-10-20，周二
博塔斯，汉密尔顿，阿尔本，阿隆索

## 2026-10-21，周三
诺里斯，奥康，林德布拉德，博托莱托

## 2026-10-22，周四
皮亚斯特里，安东内利，维斯塔潘，拉塞尔

## 2026-10-23，周五
劳森，加斯利，科拉平托，佩雷斯

## 2026-10-26，周一
霍肯伯格，比尔曼，哈贾尔，斯特罗尔

## 2026-10-27，周二
勒克莱尔，塞恩斯，博塔斯，汉密尔顿

## 2026-10-28，周三
阿尔本，阿隆索，诺里斯，奥康

## 2026-10-29，周四
林德布拉德，博托莱托，皮亚斯特里，安东内利

## 2026-10-30，周五
维斯塔潘，拉塞尔，劳森，加斯利

## 2026-11-02，周一
科拉平托，佩雷斯，霍肯伯格，比尔曼`;

// ---------- 显示模式切换（URL 参数驱动，不持久化） ----------

// 当前模式：URL 参数 theme=day/dark 强制日/夜；无参数跟随设备
function getThemeMode() {
  const theme = new URLSearchParams(location.search).get('theme');
  return theme === 'day' || theme === 'dark' ? theme : 'device';
}

// 模式显示名，用于按钮 title/aria-label 与 toast
function themeModeLabel(mode) {
  if (mode === 'day') return '日间模式';
  if (mode === 'dark') return '夜间模式';
  return '跟随设备';
}

// 按当前模式同步按钮图标与描述（跟随设备=电脑图标）
function updateThemeModeButton() {
  const mode = getThemeMode();
  if (elements.topModeIcon) {
    elements.topModeIcon.textContent = mode === 'day' ? 'light_mode' : mode === 'dark' ? 'dark_mode' : 'computer';
  }
  const label = themeModeLabel(mode);
  elements.topBtnMode?.setAttribute('aria-label', label);
  elements.topBtnMode?.setAttribute('title', label);
}

// 点击循环：跟随设备 → 日 → 夜 → 跟随设备（重写 URL 参数，整页刷新生效）
function toggleThemeMode() {
  const params = new URLSearchParams(location.search);
  const current = getThemeMode();
  if (current === 'device') params.set('theme', 'day');
  else if (current === 'day') params.set('theme', 'dark');
  else params.delete('theme');
  const qs = params.toString();
  location.href = qs ? `${location.pathname}?${qs}` : location.pathname;
}

// 应用全局状态
const state = {
  currentStep: 1,
  // 当前流程模式：'new' 新建排班 / 'editOld'  顺延自旧排班表
  mode: 'new',
  names: [],
  dailyCount: 4,
  scheduleAssignments: null, // { shuffledNames, dailyAssignments, totalDays, shiftsPerPerson, totalShifts }
  startDateStr: '',
  excludedHolidays: new Set(), // 排除放假的日期 (YYYY-MM-DD)
  manualWorkdays: new Set(),   // 手动加入的排班日 (YYYY-MM-DD，如周末调休补班)
  finalScheduleItems: [],
  markdownText: '',

  //  顺延自旧排班表流程的状态
  editOld: {
    importedItems: [],   // 导入的旧排班表 [{dateStr, weekday, names}]
    executedThrough: '', // 已执行截止日（含该天）YYYY-MM-DD
    remainingItems: [],  // 截止日之后的未执行班次（沿用原顺序）
    newStartDate: '',    // 重新编排的起始日期
    finalItems: [],
    markdownText: ''
  },

  // 月历选择器视图状态 (当前浏览的年月)
  calViewYear: 2026,
  calViewMonth: 8, // 0-11, 8 表示 9月

  // 排班结果视图（手机端默认卡片，电脑端默认表格）
  visualSubView: 'cards' // 结果页各设备一律默认卡片视图
};

//  顺延自旧排班表流程进入时备份新流程的假期设置，返回时恢复
let savedNewHolidays = null;
let savedNewWorkdays = null;

// 按当前模式返回结果视图所需的 DOM 元素集合
function getActiveViewEls() {
  if (state.mode === 'editOld') {
    return {
      cards: elements.editFinalCardsContainer,
      tableBody: elements.editFinalTableBody,
      tableScroll: elements.editFinalTableScrollContainer,
      text: elements.editViewTextContainer,
      markdown: elements.editMarkdownOutput,
      search: elements.editTableSearchInput,
      btnClear: elements.btnEditClearTableSearch,
      stats: elements.editSearchResultStats,
      empty: elements.editTableEmptySearch,
      tabs: { cards: elements.btnEditSubviewCards, table: elements.btnEditSubviewTable, text: elements.btnEditSubviewText }
    };
  }
  return {
    cards: elements.finalCardsContainer,
    tableBody: elements.finalTableBody,
    tableScroll: elements.finalTableScrollContainer,
    text: elements.viewTextContainer,
    markdown: elements.markdownOutput,
    search: elements.tableSearchInput,
    btnClear: elements.btnClearTableSearch,
    stats: elements.searchResultStats,
    empty: elements.tableEmptySearch,
    tabs: { cards: elements.btnSubviewCards, table: elements.btnSubviewTable, text: elements.btnSubviewText }
  };
}

// 按当前模式返回最终排班数据与 Markdown 文本
function getActiveScheduleData() {
  if (state.mode === 'editOld') {
    return { items: state.editOld.finalItems, markdown: state.editOld.markdownText };
  }
  return { items: state.finalScheduleItems, markdown: state.markdownText };
}

// DOM 元素引用
const elements = {
  // 步骤面板
  panels: [
    document.getElementById('panel-step-0'),
    document.getElementById('panel-step-1'),
    document.getElementById('panel-step-2'),
    document.getElementById('panel-step-3'),
    document.getElementById('panel-step-4'),
    document.getElementById('panel-step-5')
  ],

  // 顶部导航条（步骤描述 + 上一步/下一步 + 居中导览菜单）
  topBtnBack: document.getElementById('top-btn-back'),
  topBtnNext: document.getElementById('top-btn-next'),
  topBtnMode: document.getElementById('top-btn-mode'),
  topModeIcon: document.getElementById('top-mode-icon'),
  topStepTitle: document.getElementById('top-step-title'),
  topStepNumber: document.getElementById('top-step-number'),
  topStepText: document.getElementById('top-step-text'),
  topNextIcon: document.getElementById('top-next-icon'),
  topStepMenu: document.getElementById('top-step-menu'),

  // 步骤标题导览菜单（兼容旧引用：现统一指向顶部菜单）
  stepMenus: [],
  editStepMenus: [],

  // Step 1
  namesInput: document.getElementById('names-input'),
  namesCountBadge: document.getElementById('names-count-badge'),
  btnLoadSample: document.getElementById('btn-load-sample'),
  btnClearNames: document.getElementById('btn-clear-names'),
  dailyCountInput: document.getElementById('daily-count'),
  btnDecreaseDaily: document.getElementById('btn-decrease-daily'),
  btnIncreaseDaily: document.getElementById('btn-increase-daily'),
  step1CycleHint: document.getElementById('step-1-cycle-hint'),
  step1Error: document.getElementById('step-1-error'),

  // Step 2
  statTotalPeople: document.getElementById('stat-total-people'),
  statDailyPeople: document.getElementById('stat-daily-people'),
  statTotalDays: document.getElementById('stat-total-days'),
  statShiftsPerPerson: document.getElementById('stat-shifts-per-person'),
  tabStep2Days: document.getElementById('tab-step2-days'),
  tabStep2People: document.getElementById('tab-step2-people'),
  schedulePreviewList: document.getElementById('schedule-preview-list'),
  schedulePersonStatsList: document.getElementById('schedule-person-stats-list'),
  btnEditAssignments: document.getElementById('btn-edit-assignments'),
  btnReshuffle: document.getElementById('btn-reshuffle'),

  // Step 2 Modal 手工编辑弹窗
  modalEditAssignments: document.getElementById('modal-edit-assignments'),
  btnCloseEditModal: document.getElementById('btn-close-edit-modal'),
  btnCancelEditModal: document.getElementById('btn-cancel-edit-modal'),
  btnResetEditModal: document.getElementById('btn-reset-edit-modal'),
  btnSaveEditModal: document.getElementById('btn-save-edit-modal'),
  modalEditTextarea: document.getElementById('modal-edit-textarea'),
  modalEditErrors: document.getElementById('modal-edit-errors'),
  modalEditErrorsList: document.getElementById('modal-edit-errors-list'),

  // Smartisan 确认对话框（confirmDialog 复用）与 Date Time Picker 弹窗
  modalConfirm: document.getElementById('modal-confirm'),
  modalConfirmTitle: document.getElementById('modal-confirm-title'),
  modalConfirmBody: document.getElementById('modal-confirm-body'),
  btnConfirmOk: document.getElementById('btn-confirm-ok'),
  btnConfirmCancel: document.getElementById('btn-confirm-cancel'),
  modalDatePicker: document.getElementById('modal-date-picker'),
  btnPickerConfirm: document.getElementById('btn-picker-confirm'),
  btnPickerCancel: document.getElementById('btn-picker-cancel'),
  pickerTitle: document.getElementById('picker-title'),
  pickerColYear: document.getElementById('picker-col-year'),
  pickerColMonth: document.getElementById('picker-col-month'),
  pickerColDay: document.getElementById('picker-col-day'),

  // Step 3
  startDateInput: document.getElementById('start-date-input'),
  startDateWeekdayTag: document.getElementById('start-date-weekday-tag'),

  // Step 4 (月历选择器)
  // 已注释：排班区间卡片（index.html 已注释该卡片）
  // calStatRangeStart: document.getElementById('cal-stat-range-start'),
  // calStatRangeEnd: document.getElementById('cal-stat-range-end'),
  // btnCalClearAll: document.getElementById('btn-cal-clear-All') || document.getElementById('btn-cal-clear-all'),
  // 已注释：查找单日卡片（index.html 已注释该卡片）
  // calendarQuickDateInput: document.getElementById('calendar-quick-date-input'),
  // calendarQuickDateButton: document.getElementById('calendar-quick-date-button'),
  // calendarQuickDateState: document.getElementById('calendar-quick-date-state'),
  // btnQuickSetHoliday: document.getElementById('btn-quick-set-holiday'),
  // btnQuickSetWorkday: document.getElementById('btn-quick-set-workday'),
  // btnQuickResetDate: document.getElementById('btn-quick-reset-date'),
  excludedTagsContainer: document.getElementById('excluded-tags-container'),
  excludedTagsList: document.getElementById('excluded-tags-list'),
  calendarMonthTitle: document.getElementById('calendar-month-title'),
  btnPrevMonth: document.getElementById('btn-prev-month'),
  btnNextMonth: document.getElementById('btn-next-month'),
  btnJumpStartMonth: document.getElementById('btn-jump-start-month'),
  btnJumpEndMonth: document.getElementById('btn-jump-end-month'),
  calendarGrid: document.getElementById('calendar-grid'),

  // Step 5 (卡片、表格与文本共用同一视图切换器)
  markdownOutput: document.getElementById('markdown-output'),
  finalTableBody: document.getElementById('final-table-body'),
  finalCardsContainer: document.getElementById('final-cards-container'),
  finalTableScrollContainer: document.getElementById('final-table-scroll-container'),
  btnSubviewCards: document.getElementById('btn-subview-cards'),
  btnSubviewTable: document.getElementById('btn-subview-table'),
  btnSubviewText: document.getElementById('btn-subview-text'),
  btnDownloadHtml: document.getElementById('btn-download-html'),
  btnDownloadCsv: document.getElementById('btn-download-csv'),
  btnCopyMarkdown: document.getElementById('btn-copy-markdown'),
  viewTextContainer: document.getElementById('view-text-container'),
  tableSearchInput: document.getElementById('table-search-input'),
  btnClearTableSearch: document.getElementById('btn-clear-table-search'),
  searchResultStats: document.getElementById('search-result-stats'),
  tableEmptySearch: document.getElementById('table-empty-search'),

  //  顺延自旧排班表流程
  editPanels: [
    null,
    document.getElementById('panel-edit-step-1'),
    document.getElementById('panel-edit-step-2'),
    document.getElementById('panel-edit-step-3'),
    document.getElementById('panel-edit-step-4'),
    document.getElementById('panel-edit-step-5')
  ],
  editImportFileInput: document.getElementById('edit-import-file-input'),
  btnEditLoadSample: document.getElementById('btn-edit-load-sample'),
  btnEditImportFile: document.getElementById('btn-edit-import-file'),
  editImportTextarea: document.getElementById('edit-import-textarea'),
  editImportError: document.getElementById('edit-import-error'),
  editExecutedThroughInput: document.getElementById('edit-executed-through-input'),
  editExecutedWeekdayTag: document.getElementById('edit-executed-weekday-tag'),
  editStatRemaining: document.getElementById('edit-stat-remaining'),
  editImportedCardsContainer: document.getElementById('edit-imported-cards-container'),
  btnEditClearImport: document.getElementById('btn-edit-clear-import'),
  editNewStartDateInput: document.getElementById('edit-new-start-date-input'),
  editNewWeekdayTag: document.getElementById('edit-new-weekday-tag'),
  // editCalStatRangeStart: document.getElementById('edit-cal-stat-range-start'),
  // editCalStatRangeEnd: document.getElementById('edit-cal-stat-range-end'),
  // btnEditCalClearAll: document.getElementById('btn-edit-cal-clear-all'),
  editCalendarMonthTitle: document.getElementById('edit-calendar-month-title'),
  btnEditPrevMonth: document.getElementById('btn-edit-prev-month'),
  btnEditNextMonth: document.getElementById('btn-edit-next-month'),
  btnEditJumpStartMonth: document.getElementById('btn-edit-jump-start-month'),
  btnEditJumpEndMonth: document.getElementById('btn-edit-jump-end-month'),
  editExcludedTagsContainer: document.getElementById('edit-excluded-tags-container'),
  editExcludedTagsList: document.getElementById('edit-excluded-tags-list'),
  editCalendarGrid: document.getElementById('edit-calendar-grid'),
  editMarkdownOutput: document.getElementById('edit-markdown-output'),
  editFinalTableBody: document.getElementById('edit-final-table-body'),
  editFinalCardsContainer: document.getElementById('edit-final-cards-container'),
  editFinalTableScrollContainer: document.getElementById('edit-final-table-scroll-container'),
  btnEditSubviewCards: document.getElementById('btn-edit-subview-cards'),
  btnEditSubviewTable: document.getElementById('btn-edit-subview-table'),
  btnEditSubviewText: document.getElementById('btn-edit-subview-text'),
  btnEditDownloadHtml: document.getElementById('btn-edit-download-html'),
  btnEditDownloadCsv: document.getElementById('btn-edit-download-csv'),
  btnEditCopyMarkdown: document.getElementById('btn-edit-copy-markdown'),
  editViewTextContainer: document.getElementById('edit-view-text-container'),
  editTableSearchInput: document.getElementById('edit-table-search-input'),
  btnEditClearTableSearch: document.getElementById('edit-btn-clear-table-search'),
  editSearchResultStats: document.getElementById('edit-search-result-stats'),
  editTableEmptySearch: document.getElementById('edit-table-empty-search'),

  // Toast
  toast: document.getElementById('toast'),
  toastMessage: document.getElementById('toast-message'),
  toastIcon: document.getElementById('toast-icon'),

  // 网站页脚
  siteFooter: document.getElementById('site-footer'),
  siteFooterContent: document.getElementById('site-footer-content')
};

// 步骤标题导览菜单选项
const STEP_MENU_ITEMS_ZH = [
  { step: 0, title: '主页' },
  { step: 1, title: '名单与人数' },
  { step: 2, title: '轮换检查' },  { step: 3, title: '起始日期' },
  { step: 4, title: '假期修改' },
  { step: 5, title: '成功生成' }
];

// 修改自旧排班表流程的步骤导览菜单选项（0 为返回主页）
const EDIT_STEP_MENU_ITEMS_ZH = [
  { step: 0, title: '返回主页' },
  { step: 1, title: '导入旧表' },
  { step: 2, title: '检查日期' },
  { step: 3, title: '起始日期' },
  { step: 4, title: '假期修改' },
  { step: 5, title: '成功生成' }
];

function getStepMenuItems(isEditFlow) {
  return isEditFlow ? EDIT_STEP_MENU_ITEMS_ZH : STEP_MENU_ITEMS_ZH;
}

// 获取本地今日日期 YYYY-MM-DD
function getTodayDateStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// 按当前语言判断星期名是否为周末（周六/周日 或 Sat./Sun.）
function isWeekendName(name) {
  const idx = matchWeekdayToken(name);
  return idx === 0 || idx === 6;
}

// 日期展示：中文保持 YYYY-MM-DD；内部键一律也是 YYYY-MM-DD
function displayDate(dateStr) {
  return String(dateStr || '');
}

// 短日期展示（日历格子等窄位）：保持 MM-DD
function displayDateShort(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  if (!m) return dateStr;
  return `${m[2]}-${m[3]}`;
}

// Toast 消息提示
let toastTimeout = null;
function showToast(message, icon = '<span class="material-symbols-outlined text-[16px]!" aria-hidden="true">check</span>') {
  if (toastTimeout) clearTimeout(toastTimeout);
  elements.toastMessage.textContent = message;
  elements.toastIcon.innerHTML = icon;
  // 图标为空时隐藏图标占位，避免文字偏移
  elements.toastIcon.style.display = icon ? '' : 'none';
  elements.toast.classList.remove('opacity-0', '-translate-y-4');
  elements.toast.classList.add('opacity-100', 'translate-y-0');

  toastTimeout = setTimeout(() => {
    elements.toast.classList.remove('opacity-100', 'translate-y-0');
    elements.toast.classList.add('opacity-0', '-translate-y-4');
  }, 2200);
}

// 打开或关闭步骤标题导览菜单
function toggleStepMenu(anchorButton) {
  if (!anchorButton) return;

  const isCurrentOpen = anchorButton.getAttribute('aria-expanded') === 'true';
  if (elements.activeStepMenuAnchor && elements.activeStepMenuAnchor !== anchorButton) {
    closeStepMenu(elements.activeStepMenuAnchor);
  }

  if (!isCurrentOpen) {
    renderStepMenu(anchorButton);
    anchorButton.setAttribute('aria-expanded', 'true');
    elements.activeStepMenuAnchor = anchorButton;
  } else {
    closeStepMenu(anchorButton);
  }
}

function renderStepMenu(anchorButton) {
  if (!elements.topStepMenu) return;
  const isEditFlow = state.mode === 'editOld';
  const menuItems = getStepMenuItems(isEditFlow);
  elements.topStepMenu.classList.remove('hidden');
  elements.topStepMenu.querySelector('.step-menu-list').innerHTML = menuItems.map((item) => {
    const isCurrent = item.step === state.currentStep;
    return `
      <button
        type="button"
        class="step-menu-item${isCurrent ? ' is-current' : ''}"
        role="menuitem"
        onclick="selectStepMenuItem(${item.step})"
      >
        <span class="step-menu-number">${isCurrent ? `<span class="material-symbols-outlined text-[14px]!" aria-hidden="true">check</span>` : item.step}</span>
        <span>${item.title}</span>
      </button>
    `;
  }).join('');
}

function selectStepMenuItem(targetStep) {
  if (elements.activeStepMenuAnchor) closeStepMenu(elements.activeStepMenuAnchor);
  if (state.mode === 'editOld') {
    // 旧表流程：0 为返回主页，其余为流程内跳转
    if (targetStep === 0) {
      goToStep(0);
    } else {
      goToEditStep(targetStep);
    }
  } else {
    goToStep(targetStep);
  }
}

function closeStepMenu(anchorButton) {
  if (!anchorButton) return;
  anchorButton.setAttribute('aria-expanded', 'false');
  elements.topStepMenu?.classList.add('hidden');
  if (elements.activeStepMenuAnchor === anchorButton) {
    elements.activeStepMenuAnchor = null;
  }
}

// 顶部导航条当前步骤的上一步/下一步跳转目标（由 updateTopBar 维护）
let topBackTarget = null;
let topNextTarget = null;

// 同步顶部导航条：主页仅显示站名；其余步骤显示步骤描述 + 上一步/下一步
function updateTopBar() {
  if (!elements.topStepTitle || !elements.topStepText) return;
  // 主页（步骤 0）：隐藏数字与按钮，禁用菜单，仅显示站名
  if (state.currentStep === 0) {
    elements.topStepNumber.classList.add('hidden');
    elements.topStepText.textContent = '能工智人排班系统';
    elements.topStepTitle.setAttribute('aria-expanded', 'false');
    elements.topStepTitle.classList.add('pointer-events-none');
    elements.topBtnBack?.classList.add('hidden!');
    elements.topBtnNext?.classList.add('hidden!');
    elements.topBtnMode?.classList.remove('hidden!');
    // hide 参数隐藏切换按钮：即使主页也不显示
    if (window.APP_HIDE.has('theme')) elements.topBtnMode?.classList.add('hidden!');
    topBackTarget = null;
    topNextTarget = null;
    return;
  }

  // 非主页：隐藏显示模式切换
  elements.topBtnMode?.classList.add('hidden!');

  const isEditFlow = state.mode === 'editOld';
  const step = state.currentStep;
  const items = getStepMenuItems(isEditFlow);
  const item = items.find(i => i.step === step);
  const title = item ? item.title : `第 ${step} 步`;

  elements.topStepTitle.classList.remove('pointer-events-none');
  elements.topStepTitle.dataset.flow = isEditFlow ? 'edit' : 'new';
  elements.topStepNumber.classList.remove('hidden');
  elements.topStepNumber.textContent = step;
  elements.topStepText.textContent = title;

  // 上一步：新建流程第 1 步返回主页；旧表流程第 1 步也返回主页
  elements.topBtnBack?.classList.remove('hidden!');
  topBackTarget = (step === 1)
    ? () => goToStep(0)
    : isEditFlow
      ? () => goToEditStep(step - 1)
      : () => goToStep(step - 1);

  // 下一步：最后一步（新建 5 / 旧表 5）换成「重新开始」按钮（仅图标，带确认弹窗），
  // 假期调整步（新建 4 / 旧表 4）图标为对勾（完成）
  const isLast = isEditFlow ? step === 5 : step === 5;
  if (isLast) {
    elements.topBtnNext?.classList.remove('hidden!');
    if (elements.topNextIcon) elements.topNextIcon.textContent = 'refresh';
    topNextTarget = async () => {
      const confirmed = await confirmDialog(isEditFlow
        ? ('确定要重新开始修改旧排班表吗？当前导入内容与设置将被重置。')
        : ('确定要重新开始排班吗？当前所有配置将被重置。'));
      if (!confirmed) return;
      state.excludedHolidays.clear();
      state.manualWorkdays.clear();
      state.scheduleAssignments = null;
      if (isEditFlow) {
        resetEditOldFlow();
      } else {
        goToStep(1);
      }
    };
  } else {
    elements.topBtnNext?.classList.remove('hidden!');
    if (elements.topNextIcon) {
      elements.topNextIcon.textContent = (!isEditFlow && step === 4) ? 'check' : 'arrow_forward';
    }
    topNextTarget = isEditFlow
      ? (step === 1 ? () => handleEditToStep2() : () => goToEditStep(step + 1))
      : () => goToStep(step + 1);
  }
}

// 已加载的页脚 Markdown，导出独立 HTML 时会直接内联
var siteFooterMarkdown = '';

// 解析页脚 Markdown，当前仅需支持段落和行内链接/图片
function renderInlineMarkdown(text) {
  const escapedText = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  return escapedText
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (match, alt, href) => {
      return `<img src="${href}" alt="${alt}">`;
    })
    .replace(/\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (match, label, href) => {
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });
}

function renderMarkdownFooter(markdown) {
  const lines = markdown.trim().split(/\r?\n/);
  const paragraphLines = [];
  const renderedBlocks = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    // Markdown 行尾两个空格表示硬换行，避免多行内容被合并
    let currentLine = [];
    const lineBlocks = [];

    const flushLine = () => {
      if (currentLine.length === 0) return;
      lineBlocks.push(`<span class="site-footer-line">${currentLine.join(' ')}</span>`);
      currentLine = [];
    };

    paragraphLines.forEach(line => {
      const hasHardBreak = /  $/.test(line);
      currentLine.push(renderInlineMarkdown(hasHardBreak ? line.trimEnd() : line));
      if (hasHardBreak) flushLine();
    });
    flushLine();

    renderedBlocks.push(`<p>${lineBlocks.join('')}</p>`);
    paragraphLines.length = 0;
  };

  lines.forEach(rawLine => {
    // 兼容 docs/footer.md 使用 <div align="center"> 包裹 Markdown 的写法
    if (/^\s*(?:<div\b[^>]*>|<\/div>|<!--[\s\S]*?-->)\s*$/i.test(rawLine)) {
      flushParagraph();
      return;
    }

    const line = rawLine.trimStart();
    if (line === '') {
      flushParagraph();
      return;
    }
    paragraphLines.push(line);
  });
  flushParagraph();

  return renderedBlocks.join('');
}

function loadSiteFooter() {
  // hide 参数含 footer 时隐藏页脚并跳过加载
  if (window.APP_HIDE.has('footer')) {
    if (elements.siteFooter) elements.siteFooter.hidden = true;
    return;
  }
  if (!elements.siteFooter || !elements.siteFooterContent) return;

  const renderLoadedFooter = () => {
    if (typeof window.FOOTER_MARKDOWN !== 'string') return;
    siteFooterMarkdown = window.FOOTER_MARKDOWN;
    elements.siteFooterContent.innerHTML = renderMarkdownFooter(siteFooterMarkdown);
    elements.siteFooter.hidden = elements.siteFooterContent.innerHTML.trim() === '';

    // 重新加载时移除旧脚本，确保后续变更可重新触发
    document.querySelectorAll('script[data-footer-loader]').forEach(node => node.remove());
  };

  // 页面直开（file://）时 fetch/XHR 均受浏览器限制，通过 JS 文件承载 Markdown 内容
  const script = document.createElement('script');
  script.dataset.footerLoader = 'true';
  script.onload = renderLoadedFooter;
  script.onerror = () => {
    console.error('页脚加载失败');
    elements.siteFooter.hidden = true;
    document.querySelectorAll('script[data-footer-loader]').forEach(node => node.remove());
  };
  script.src = `docs/footer.md?_=${Date.now()}`;
  document.head.appendChild(script);
}

// 错误提示
function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}
function hideError(el) {
  el.classList.add('hidden');
}

// 步骤 1 实时输入与无余数周期计算
function handleStep1Inputs() {
  const parsed = parseNames(elements.namesInput.value);
  const count = parsed.length;
  elements.namesCountBadge.textContent = `已识别 ${count} 人`;

  const daily = parseInt(elements.dailyCountInput.value, 10) || 4;

  if (count > 0 && daily > 0) {
    const cycle = calculateCycle(count, daily);

    if (count >= daily) {
      elements.step1CycleHint.innerHTML = `
        需排班 <span class="text-s-blue-400 font-bold text-sm">${cycle.totalDays}</span> 天整；<br>
        每人值班 <span class="text-s-blue-400 font-bold text-sm">${cycle.shiftsPerPerson}</span> 次；<br>
        总计 <span class="text-s-blue-400 font-bold text-sm">${cycle.totalShifts}</span> 班次。
      `;
      hideError(elements.step1Error);
    } else {
      elements.step1CycleHint.innerHTML = `<span class="text-s-chip-yellow-text font-medium">⚠️ 总人数 (${count}人) 少于每日值班人数 (${daily}人)，请补充人员或调低每日人数。</span>`;
    }
  } else {
    elements.step1CycleHint.textContent = '等待键入...';
  }
}

// 步骤向导跳转控制
function goToStep(targetStep) {
  if (targetStep < 0 || targetStep > 5) return;

  // 校验前往后续步骤的前提条件（步骤 0 主页与步骤 1 名单填写页本身不校验）
  if (targetStep >= 2) {
    const rawNames = elements.namesInput.value;
    const parsed = parseNames(rawNames);
    const dailyCount = parseInt(elements.dailyCountInput.value, 10) || 4;

    if (parsed.length === 0) {
      showError(elements.step1Error, '请先输入至少一组人员姓名');
      return;
    }
    if (parsed.length < dailyCount) {
      showError(elements.step1Error, `总人数 (${parsed.length}人) 不能少于每日值班人数 (${dailyCount}人)`);
      return;
    }
    hideError(elements.step1Error);

    // 检查是否需要重新生成排班方案
    const namesChanged = JSON.stringify(parsed) !== JSON.stringify(state.names);
    const dailyChanged = dailyCount !== state.dailyCount;

    state.names = parsed;
    state.dailyCount = dailyCount;

    if (!state.scheduleAssignments || namesChanged || dailyChanged) {
      generateAssignments();
    }
  }

  if (targetStep >= 4) {
    if (!state.startDateStr) {
      state.startDateStr = elements.startDateInput.value || getTodayDateStr();
    }

    // 同步月历视图初始月份为开始日期所在月
    const startD = parseDate(state.startDateStr);
    state.calViewYear = startD.getFullYear();
    state.calViewMonth = startD.getMonth();
    renderStep4Calendar();
  }

  if (targetStep === 5) {
    renderFinalSchedule();
    // 进入结果页时保持既定默认视图（一律默认卡片）
    setScheduleView(state.visualSubView);
  }


  // 更新面板可见性
  for (let i = 0; i <= 5; i++) {
    if (elements.panels[i]) {
      if (i === targetStep) {
        elements.panels[i].classList.remove('hidden');
      } else {
        elements.panels[i].classList.add('hidden');
      }
    }
  }

  // 隐藏 顺延自旧排班表面板；从旧表流程返回时恢复新流程的假期设置
  if (state.mode === 'editOld') {
    state.mode = 'new';
    if (savedNewHolidays) state.excludedHolidays = savedNewHolidays;
    if (savedNewWorkdays) state.manualWorkdays = savedNewWorkdays;
    savedNewHolidays = null;
    savedNewWorkdays = null;
  }
  elements.editPanels.forEach(p => p && p.classList.add('hidden'));

  state.currentStep = targetStep;
  updateTopBar();
  // 将当前步骤同步到网址参数：仅用 ?step=N 表示新流程，同时清除 editStep（两参数互斥）；
  // 步骤 0（主页）不带任何步骤参数，其余参数（如 theme 保留）
  const params = new URLSearchParams(location.search);
  params.delete('editStep');
  if (targetStep > 0) params.set('step', targetStep); else params.delete('step');
  const qs = params.toString();
  history.replaceState(null, '', qs ? `${location.pathname}?${qs}` : location.pathname);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// 步骤 2 生成严格无余数轮换方案
function generateAssignments() {
  try {
    state.scheduleAssignments = generateScheduleAssignments(state.names, state.dailyCount);
    renderStep2Preview();
  } catch (err) {
    showError(elements.step1Error, err.message);
  }
}

function renderStep2Preview() {
  const { totalDays, shiftsPerPerson, totalShifts, dailyAssignments } = state.scheduleAssignments;

  elements.statTotalPeople.textContent = `${state.names.length} 人`;
  elements.statDailyPeople.textContent = `${state.dailyCount} 人`;
  elements.statTotalDays.textContent = `${totalDays} 天整`;
  elements.statShiftsPerPerson.textContent = `${shiftsPerPerson} 次`;

  // 1. 渲染按天轮替预览
  const daysHtml = dailyAssignments.map((dayGroup, idx) => {
    const namesChips = dayGroup.map(name =>
      `<span class="inline-block bg-s-grey-100 text-s-grey-900 font-medium px-2.5 py-0.5 rounded-md text-xs border border-s-grey-400 mr-1.5 my-0.5">${name}</span>`
    ).join('');

    return `
      <div class="px-4 py-2.5 flex items-center justify-between active:bg-s-grey-100">
        <div class="flex items-center space-x-3">
          <span class="w-16 text-xs font-bold text-s-grey-600">第 ${idx + 1} 天</span>
          <div class="flex flex-wrap items-center">
            ${namesChips}
          </div>
        </div>
        <span class="text-xs text-s-grey-600 hidden sm:inline">${dayGroup.length}人</span>
      </div>
    `;
  }).join('');
  elements.schedulePreviewList.innerHTML = daysHtml;

  // 2. 渲染按人统计检查（验证每人均值班 shiftsPerPerson 次）
  const personShiftsMap = {};
  state.names.forEach(name => {
    personShiftsMap[name] = [];
  });
  dailyAssignments.forEach((dayGroup, dayIdx) => {
    dayGroup.forEach(name => {
      if (!personShiftsMap[name]) personShiftsMap[name] = [];
      personShiftsMap[name].push(dayIdx + 1);
    });
  });

  const peopleHtml = Object.keys(personShiftsMap).map((name, idx) => {
    const days = personShiftsMap[name];
    const daysBadges = days.map(d => `<span class="inline-block bg-s-blue-100 text-s-blue-400 font-mono text-[11px] px-2 py-0.5 rounded border border-s-chip-blue-border mr-1 my-0.5">第 ${d} 天</span>`).join('');
    return `
      <div class="px-4 py-2.5 flex items-center justify-between active:bg-s-grey-100">
        <div class="flex items-center space-x-3 flex-1">
          <span class="w-8 text-xs font-mono text-s-grey-600 text-right">${idx + 1}.</span>
          <span class="font-bold text-xs sm:text-sm text-s-grey-900 w-24">${name}</span>
          <div class="flex flex-wrap items-center flex-1">
            ${daysBadges}
          </div>
        </div>
        <span class="text-xs font-bold text-s-blue-400 ml-2">共 ${days.length} 次</span>
      </div>
    `;
  }).join('');
  elements.schedulePersonStatsList.innerHTML = peopleHtml;
}

// 打开第 2 步手动修改轮换方案弹窗
function openEditAssignmentsModal() {
  if (!state.scheduleAssignments || !state.scheduleAssignments.dailyAssignments) return;
  
  // 生成当前轮换分配的 Markdown
  const mdText = formatAssignmentsToMarkdown(state.scheduleAssignments.dailyAssignments);
  elements.modalEditTextarea.value = mdText;
  
  // 重置错误提示
  elements.modalEditErrors.classList.add('hidden');
  elements.modalEditErrorsList.innerHTML = '';
  
  // 显示弹窗
  elements.modalEditAssignments.classList.remove('hidden');
  elements.modalEditTextarea.focus();
}

// 关闭第 2 步手动修改轮换方案弹窗
function closeEditAssignmentsModal() {
  elements.modalEditAssignments.classList.add('hidden');
  elements.modalEditErrors.classList.add('hidden');
  elements.modalEditErrorsList.innerHTML = '';
}

// 重置弹窗内文本为当前方案
function resetEditAssignmentsModal() {
  if (!state.scheduleAssignments || !state.scheduleAssignments.dailyAssignments) return;
  elements.modalEditTextarea.value = formatAssignmentsToMarkdown(state.scheduleAssignments.dailyAssignments);
  elements.modalEditErrors.classList.add('hidden');
  elements.modalEditErrorsList.innerHTML = '';
  showToast('成功重置');
}

// 保存并检查修改后的轮换方案
function saveEditAssignmentsModal() {
  if (!state.scheduleAssignments) return;

  const text = elements.modalEditTextarea.value;
  const expectedDays = state.scheduleAssignments.totalDays;
  const expectedDailyCount = state.dailyCount;
  const originalNames = state.names;
  const expectedShiftsPerPerson = state.scheduleAssignments.shiftsPerPerson;

  // 执行严格解析与校验
  const result = parseAndValidateAssignmentsMarkdown(
    text,
    expectedDays,
    expectedDailyCount,
    originalNames,
    expectedShiftsPerPerson
  );

  if (!result.isValid) {
    // 校验未通过：渲染错误信息并阻断保存
    elements.modalEditErrorsList.innerHTML = result.errors.map(err => `<li>${err}</li>`).join('');
    elements.modalEditErrors.classList.remove('hidden');
    elements.modalEditErrors.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    showToast('错误', '<span class="material-symbols-outlined text-[16px]!" aria-hidden="true">error</span>');
    return;
  }

  // 校验完全通过：更新状态中的轮替方案
  state.scheduleAssignments.dailyAssignments = result.dailyAssignments;
  
  // 重新渲染第 2 步列表和统计检查
  renderStep2Preview();

  // 关闭弹窗并给予成功反馈
  closeEditAssignmentsModal();
  showToast('成功！');
}

// 步骤 3 起始日期变化监听
function handleStartDateChange() {
  const val = elements.startDateInput.value;
  if (!val) return;
  const oldStart = state.startDateStr;
  state.startDateStr = val;

  // 起始日期变化后，合法选择区间随之变化，需清理已超出范围的记录
  const validRange = getScheduleDateRange();
  pruneScheduleDateSelections(validRange.start, validRange.end);

  if (oldStart && oldStart !== val) {
    const startD = parseDate(val);
    state.calViewYear = startD.getFullYear();
    state.calViewMonth = startD.getMonth();
  }

  const date = parseDate(val);
  const dayOfWeek = date.getDay();
  const weekday = weekdayName(dayOfWeek);
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    elements.startDateWeekdayTag.innerHTML = `
      <span class="text-s-chip-yellow-text font-bold">该日为 ${weekday}（非工作日）</span>，排班将从最近的工作日或调休补班日开始。
    `;
  } else {
    elements.startDateWeekdayTag.innerHTML = `
      起始日为 <span class="text-s-blue-400 font-semibold">${weekday}</span>（工作日）。
    `;
  }
}

// ----------------------------------------------------
// 步骤 4：月历选择器核心逻辑 (Calendar Picker)
// ----------------------------------------------------

// 计算本次排班的完整可选区间（旧表流程自动切换到新起始日期区间）
function getScheduleDateRange() {
  if (state.mode === 'editOld') {
    return getEditScheduleDateRange();
  }
  const totalDays = state.scheduleAssignments ? state.scheduleAssignments.totalDays : 0;
  const { workdays } = computeScheduleDates(
    state.startDateStr || getTodayDateStr(),
    totalDays + 1,
    state.excludedHolidays,
    state.manualWorkdays
  );
  const allowedWorkdays = workdays.slice(0, totalDays);
  const fallbackDate = state.startDateStr || getTodayDateStr();

  return {
    start: fallbackDate,
    end: allowedWorkdays.length > 0 ? allowedWorkdays[allowedWorkdays.length - 1].dateStr : fallbackDate
  };
}

function isScheduleDateOutsideRange(dateStr, validRange) {
  return dateStr < validRange.start || dateStr > validRange.end;
}

function validateScheduleDateSelection(dateStr) {
  const validRange = getScheduleDateRange();
  if (isScheduleDateOutsideRange(dateStr, validRange)) {
    showToast(`只能选择 ${validRange.start} 至 ${validRange.end} 内的日期`, '<span class="material-symbols-outlined text-[16px]!" aria-hidden="true">warning</span>');
    return true;
  }
  return false;
}

function pruneScheduleDateSelections(rangeStart, rangeEnd) {
  const isOutside = dateStr => dateStr < rangeStart || dateStr > rangeEnd;
  Array.from(state.excludedHolidays).filter(isOutside).forEach(dateStr => state.excludedHolidays.delete(dateStr));
  Array.from(state.manualWorkdays).filter(isOutside).forEach(dateStr => state.manualWorkdays.delete(dateStr));
}

// 查找单日的状态机查询；dateStatus 供日历与快速选择器共用
function getQuickDateState(dateStr) {
  if (!dateStr) {
    return { dateStatus: 'unselected', allowedActions: { holiday: false, workday: false, reset: false }, message: '请选择' };
  }

  const validRange = getScheduleDateRange();
  if (isScheduleDateOutsideRange(dateStr, validRange)) {
    return {
      dateStatus: 'outside',
      allowedActions: { holiday: false, workday: false, reset: false },
      message: '这天是：超出排班区间'
    };
  }

  const date = parseDate(dateStr);
  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
  const isManualHoliday = state.excludedHolidays.has(dateStr);
  const isManualWorkday = state.manualWorkdays.has(dateStr);

  if (isManualHoliday) {
    return {
      dateStatus: 'manual-holiday',
      allowedActions: { holiday: false, workday: true, reset: true },
      message: '这天是：手动节假日'
    };
  }

  if (isManualWorkday) {
    return {
      dateStatus: 'manual-workday',
      allowedActions: { holiday: true, workday: false, reset: true },
      message: '这天是：调休补班'
    };
  }

  if (isWeekend) {
    return {
      dateStatus: 'weekend',
      allowedActions: { holiday: false, workday: true, reset: false },
      message: '这天是：双休日'
    };
  }

  return {
    dateStatus: 'default-workday',
    allowedActions: { holiday: true, workday: false, reset: false },
    message: '这天是：默认排班'
  };
}

function updateQuickDateState() {
  // 已注释：查找单日卡片已移除（见 index.html），保留空函数占位
  /*
  const quickState = getQuickDateState(elements.calendarQuickDateInput.value);
  // 查找单日输入框即选择按钮（Smartisan Date Time Picker 弹窗触发器），
  // 值保持 YYYY-MM-DD 供各 handleQuick* 读取；未选择时为空、显示 placeholder"请选择"
  elements.calendarQuickDateState.textContent = quickState.message;

  const statusStyles = {
    unselected: 'text-s-grey-600',
    outside: 'text-s-grey-600',
    'default-workday': 'text-s-blue-400',
    weekend: 'text-s-grey-600',
    'manual-holiday': 'text-s-chip-red-text',
    'manual-workday': 'text-s-chip-yellow-text'
  };
  elements.calendarQuickDateState.className = `text-xs font-semibold ${statusStyles[quickState.dateStatus]}`;

  elements.btnQuickSetHoliday.disabled = !quickState.allowedActions.holiday;
  elements.btnQuickSetWorkday.disabled = !quickState.allowedActions.workday;
  elements.btnQuickResetDate.disabled = !quickState.allowedActions.reset;

  elements.btnQuickSetHoliday.classList.toggle('opacity-40', elements.btnQuickSetHoliday.disabled);
  elements.btnQuickSetHoliday.classList.toggle('cursor-not-allowed', elements.btnQuickSetHoliday.disabled);
  elements.btnQuickSetWorkday.classList.toggle('opacity-40', elements.btnQuickSetWorkday.disabled);
  elements.btnQuickSetWorkday.classList.toggle('cursor-not-allowed', elements.btnQuickSetWorkday.disabled);
  elements.btnQuickResetDate.classList.toggle('opacity-40', elements.btnQuickResetDate.disabled);
  elements.btnQuickResetDate.classList.toggle('cursor-not-allowed', elements.btnQuickResetDate.disabled);
  */
}

// ----------------------------------------------------
// Smartisan Date Time Picker（Kit 147:276 三列滚轮）与确认对话框
// 所有 [data-picker-field] 日期输入框点击时弹出本弹窗，确认后写回
// input.value 并派发 change 事件——原有业务监听逻辑零改动
// ----------------------------------------------------

const SMT_PICKER = {
  itemPitch: 54,   // 行高 38 + 间距 16（style.css .smt-picker__col > span）
  years: [],
  months: [],
  days: [],
  value: { y: 2026, m: 1, d: 1 }, // 当前滚轮选中值（m/d 为 1 起始）
  min: '',         // YYYY-MM-DD 或 ''
  max: '',
  onConfirm: null
};

// 生成滚轮列内容（aria-selected 高亮由 CSS 处理；滚动定位统一走 scrollToPickerValue）
function buildPickerCol(colEl, values, selected) {
  colEl.innerHTML = values
    .map(v => `<span data-v="${v.v}" aria-selected="${v.v === selected ? 'true' : 'false'}">${v.t}</span>`)
    .join('');
}

// 打开滚轮弹窗；opts: { value, min, max, title, onConfirm }
function openDatePickerDialog(opts) {
  const min = opts.min || '';
  const max = opts.max || '';
  SMT_PICKER.min = min;
  SMT_PICKER.max = max;

  // 有范围限制时，把初始值夹到合法区间内，非法日期不再可选中
  let value = opts.value;
  if (min && value < min) value = min;
  if (max && value > max) value = max;
  const [y, m, d] = value.split('-').map(Number);
  SMT_PICKER.onConfirm = opts.onConfirm || null;
  SMT_PICKER.value = { y, m, d };
  // 标题默认展示当前选中日期（英文为月份缩写格式）
  elements.pickerTitle.textContent = opts.title || displayDate(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);

  // 年份范围：以 min/max 为界，缺省前后各扩 10 年
  const minY = SMT_PICKER.min ? Number(SMT_PICKER.min.slice(0, 4)) : y - 10;
  const maxY = SMT_PICKER.max ? Number(SMT_PICKER.max.slice(0, 4)) : y + 10;
  SMT_PICKER.years = [];
  for (let yy = minY; yy <= maxY; yy++) SMT_PICKER.years.push({ v: yy, t: `${yy}` });
  buildPickerCol(elements.pickerColYear, SMT_PICKER.years, y);

  refreshPickerCols();
  elements.modalDatePicker.classList.remove('hidden');
  // 显示后再定位滚轮（display:none 时 clientHeight 为 0，无法计算滚动位置）
  requestAnimationFrame(() => {
    scrollToPickerValue(elements.pickerColYear, SMT_PICKER.value.y);
    scrollToPickerValue(elements.pickerColMonth, SMT_PICKER.value.m);
    scrollToPickerValue(elements.pickerColDay, SMT_PICKER.value.d);
  });
}

// 将滚轮列滚动到指定值（居中到选中带）
function scrollToPickerValue(colEl, v) {
  const target = colEl.querySelector(`span[data-v="${v}"]`);
  if (target) {
    colEl.scrollTop = target.offsetTop - (colEl.clientHeight - target.offsetHeight) / 2;
  }
}

// 按当前年月重算日列（含闰月天数），并按 min/max 裁剪月/日列——限制外的日期直接不展示
function refreshPickerCols() {
  const { y, d } = SMT_PICKER.value;
  const ym = `${y}-${String(SMT_PICKER.value.m).padStart(2, '0')}`;

  // 月列：当前年份与 min/max 同年时，裁剪到其所在月份区间
  let minM = 1, maxM = 12;
  const minY = SMT_PICKER.min ? Number(SMT_PICKER.min.slice(0, 4)) : '';
  const maxY = SMT_PICKER.max ? Number(SMT_PICKER.max.slice(0, 4)) : '';
  if (minY !== '' && y === minY) minM = Number(SMT_PICKER.min.slice(5, 7));
  if (maxY !== '' && y === maxY) maxM = Number(SMT_PICKER.max.slice(5, 7));
  // 切换到边界年份后，当前月可能超出裁剪范围，需夹回
  const clampedMonth = Math.min(Math.max(SMT_PICKER.value.m, minM), maxM);
  if (clampedMonth !== SMT_PICKER.value.m) SMT_PICKER.value.m = clampedMonth;
  SMT_PICKER.months = [];
  for (let mm = minM; mm <= maxM; mm++) SMT_PICKER.months.push({ v: mm, t: `${mm} 月` });

  // 日列：当前年月与 min/max 同月时，裁剪到其所在日期边界
  const cym = `${y}-${String(clampedMonth).padStart(2, '0')}`;
  let minD = 1, maxD = new Date(y, clampedMonth, 0).getDate();
  if (SMT_PICKER.min && SMT_PICKER.min.slice(0, 7) === cym) minD = Number(SMT_PICKER.min.slice(8, 10));
  if (SMT_PICKER.max && SMT_PICKER.max.slice(0, 7) === cym) maxD = Number(SMT_PICKER.max.slice(8, 10));
  const clampedDay = Math.min(Math.max(d, minD), maxD);
  if (clampedDay !== d) SMT_PICKER.value.d = clampedDay;
  SMT_PICKER.days = [];
  for (let dd = minD; dd <= maxD; dd++) SMT_PICKER.days.push({ v: dd, t: `${dd} 日` });

  const prevScroll = [elements.pickerColMonth, elements.pickerColDay].map(c => c.scrollTop);
  // 月列内容可能整体变化（进入边界月），重建后需重新定位到当前选中月
  buildPickerCol(elements.pickerColMonth, SMT_PICKER.months, clampedMonth);
  buildPickerCol(elements.pickerColDay, SMT_PICKER.days, clampedDay);
  elements.pickerColMonth.scrollTop = prevScroll[0];
  elements.pickerColDay.scrollTop = prevScroll[1];
}

// 从滚动位置读回选中值（吸附由 scroll-snap 保证，取距选中带中心最近的项）
function readPickerCol(colEl) {
  const center = colEl.scrollTop + colEl.clientHeight / 2;
  let best = null;
  colEl.querySelectorAll('span').forEach(sp => {
    const mid = sp.offsetTop + sp.offsetHeight / 2;
    if (best === null || Math.abs(mid - center) < Math.abs(best.mid - center)) {
      best = { v: Number(sp.dataset.v), mid };
    }
  });
  return best ? best.v : 1;
}

// 滚轮滚动结束（scroll 事件停止 120ms 后）刷新高亮与标题
function schedulePickerScrollSync(colEl) {
  clearTimeout(colEl._smtSyncTimer);
  colEl._smtSyncTimer = setTimeout(() => {
    const idx = ['pickerColYear', 'pickerColMonth', 'pickerColDay'].find(k => elements[k] === colEl);
    if (idx === 'pickerColYear') SMT_PICKER.value.y = readPickerCol(colEl);
    if (idx === 'pickerColMonth') SMT_PICKER.value.m = readPickerCol(colEl);
    if (idx === 'pickerColDay') SMT_PICKER.value.d = readPickerCol(colEl);
    const { y, m, d } = SMT_PICKER.value;
    elements.pickerTitle.textContent = displayDate(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    refreshPickerCols();
  }, 120);
}

function closeDatePickerDialog() {
  elements.modalDatePicker.classList.add('hidden');
}

// 确认：拼回 YYYY-MM-DD（不早于 min / 不晚于 max 已由限制保证）
function confirmDatePickerDialog() {
  const { y, m, d } = SMT_PICKER.value;
  closeDatePickerDialog();
  const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (SMT_PICKER.onConfirm) SMT_PICKER.onConfirm(dateStr);
}

// Smartisan 确认对话框（替代 window.confirm）：返回 Promise<boolean>
function confirmDialog(message, title) {
  return new Promise(resolve => {
    elements.modalConfirmTitle.textContent = title || '请确认';
    elements.modalConfirmBody.textContent = message;
    elements.modalConfirm.classList.remove('hidden');
    const done = val => {
      elements.modalConfirm.classList.add('hidden');
      elements.btnConfirmOk.onclick = null;
      elements.btnConfirmCancel.onclick = null;
      resolve(val);
    };
    elements.btnConfirmOk.onclick = () => done(true);
    elements.btnConfirmCancel.onclick = () => done(false);
    elements.modalConfirm.onclick = e => {
      if (e.target === elements.modalConfirm) done(false);
    };
  });
}


function renderStep4Calendar() {
  const totalDays = state.scheduleAssignments.totalDays;
  const hasSchedule = Boolean(totalDays);

  // 兼容历史状态：渲染前强制清掉超出当前合法区间的选择
  const validRange = getScheduleDateRange();
  pruneScheduleDateSelections(validRange.start, validRange.end);
  const renderRange = getScheduleDateRange();

  // 扫描结束日的后一天，确保非法补班日期也能获得日历状态和不可选提示
  const { workdays, datesMap } = hasSchedule
    ? computeScheduleDates(
        state.startDateStr,
        totalDays + 1,
        state.excludedHolidays,
        state.manualWorkdays
      )
    : { workdays: [], datesMap: new Map() };

  // 更新排班区间卡片
  // 更新排班区间卡片（卡片已注释，保留数据计算）
  /*
  if (hasSchedule && workdays.length >= totalDays) {
    elements.calStatRangeStart.textContent = renderRange.start.replaceAll('-', '/');
    elements.calStatRangeEnd.textContent = renderRange.end.replaceAll('-', '/');
  } else {
    elements.calStatRangeStart.textContent = '-';
    elements.calStatRangeEnd.textContent = '-';
  }
  */

  // 渲染排除与补班标记标签栏
  renderExcludedAndManualTags();

  // 渲染月历头部标题
  const year = state.calViewYear;
  const month = state.calViewMonth; // 0-11
  elements.calendarMonthTitle.textContent = `${year}/${String(month + 1).padStart(2, '0')}`;

  // 快速日期输入的范围需要随当前排班区间实时更新（查找单日卡片已注释）
  /*
  elements.calendarQuickDateInput.min = renderRange.start;
  if (renderRange.end > renderRange.start) {
    elements.calendarQuickDateInput.max = renderRange.end;
  } else {
    elements.calendarQuickDateInput.removeAttribute('max');
  }
  updateQuickDateState();
  */

  // 渲染月历网格
  renderMonthGrid(year, month, datesMap, renderRange);
}

// 渲染月历格子 (7列 x 5~6行)；gridEl 缺省时渲染新流程的日历网格
function renderMonthGrid(year, month, datesMap, validRange, gridEl) {
  const grid = gridEl || elements.calendarGrid;
  const firstDayOfMonth = new Date(year, month, 1);
  const startDayOfWeek = firstDayOfMonth.getDay(); // 0 = 周日, 1 = 周一, ...

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  let cellsHtml = '';

  // 1. 上月留白填充格子
  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    const prevDayNum = daysInPrevMonth - i;
    const prevDate = new Date(year, month - 1, prevDayNum);
    const dateStr = formatDate(prevDate);
    cellsHtml += buildCalendarCellHtml(dateStr, prevDayNum, true, datesMap, validRange);
  }

  // 2. 当月日期格子
  for (let day = 1; day <= daysInMonth; day++) {
    const curDate = new Date(year, month, day);
    const dateStr = formatDate(curDate);
    cellsHtml += buildCalendarCellHtml(dateStr, day, false, datesMap, validRange);
  }

  // 3. 下月留白填充格子（补齐到7的倍数）
  const totalRendered = startDayOfWeek + daysInMonth;
  const remainingCells = (7 - (totalRendered % 7)) % 7;
  for (let day = 1; day <= remainingCells; day++) {
    const nextDate = new Date(year, month + 1, day);
    const dateStr = formatDate(nextDate);
    cellsHtml += buildCalendarCellHtml(dateStr, day, true, datesMap, validRange);
  }

  grid.innerHTML = cellsHtml;
}

// 构建单个日历格子的 HTML
function buildCalendarCellHtml(dateStr, dayNum, isOtherMonth, datesMap, validRange) {
  const dateObj = parseDate(dateStr);
  const dayOfWeek = dateObj.getDay();
  const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);

  const dayInfo = datesMap.get(dateStr);
  const isExcluded = state.excludedHolidays.has(dateStr);
  const isManual = state.manualWorkdays.has(dateStr);

  let cellBgClass = '';
  let borderClass = 'border-s-grey-400';
  let badgeHtml = '';
  let textColor = isOtherMonth ? 'text-s-grey-500' : 'text-s-grey-800';
  let isColored = false;
  const isDateDisabled = isScheduleDateOutsideRange(dateStr, validRange);

  if (isDateDisabled) {
    cellBgClass = 'bg-s-grey-100 cursor-not-allowed';
    borderClass = 'border-s-grey-400';
    badgeHtml = '';
    textColor = isOtherMonth ? 'text-s-grey-500' : 'text-s-grey-600';
  } else if (dayInfo && dayInfo.isWorkday) {
    if (isManual) {
      cellBgClass = 'bg-s-chip-yellow-text border-s-chip-yellow-border active:opacity-90';
      badgeHtml = ''; // 状态已用颜色区分，不再显示班/休/补文字标记
      textColor = 'text-white font-bold';
      isColored = true;
    } else {
      cellBgClass = 'bg-s-blue-300 border-s-blue-300 active:opacity-90';
      badgeHtml = '';
      textColor = 'text-white font-semibold';
      isColored = true;
    }
  } else if (isExcluded) {
    cellBgClass = 'bg-s-chip-red-text border-s-chip-red-border active:opacity-90';
    badgeHtml = '';
    textColor = 'text-white line-through font-medium';
    isColored = true;
  } else if (isWeekend) {
    cellBgClass = isOtherMonth ? 'bg-s-grey-100' : 'bg-s-icon-chevron border-s-icon-chevron active:opacity-90';
    badgeHtml = '';
    textColor = isOtherMonth ? 'text-s-grey-500' : 'text-white';
    if (!isOtherMonth) isColored = true;
  } else {
    cellBgClass = isOtherMonth ? 'bg-s-grey-100' : 'bg-white active:bg-s-blue-100/30';
    badgeHtml = '';
    textColor = isOtherMonth ? 'text-s-grey-500' : 'text-s-grey-800';
  }

  let titleTooltip = `${displayDate(dateStr)} (${weekdayName(dayOfWeek)})`;
  if (isDateDisabled) {
    titleTooltip += ' [不可选择] 仅允许修改起始日期至实际排班结束日期范围内的日期';
  } else if (dayInfo && dayInfo.isWorkday) {
    titleTooltip += ` [排班第${dayInfo.workdayIndex}天] 点击设为放假`;
  } else if (isExcluded) {
    titleTooltip += ' [放假跳过] 点击恢复排班';
  } else if (isWeekend) {
    titleTooltip += ' [周末] 点击设为调休补班';
  }

  return `
    <div class="calendar-cell p-2 select-none flex flex-col justify-between border ${borderClass} ${cellBgClass}"
         onclick="handleCalendarCellClick('${dateStr}')"
         title="${titleTooltip}">
      <div class="flex items-center justify-between">
        <span class="text-xs font-bold ${textColor}">${dayNum}</span>
        ${badgeHtml}
      </div>
      <div class="text-[10px] text-right ${isColored ? 'text-white/70' : 'text-s-grey-600'}">
        ${displayDateShort(dateStr)}
      </div>
    </div>
  `;
}

// 日历单元格点击事件交互
function handleCalendarCellClick(dateStr) {
  if (validateScheduleDateSelection(dateStr)) return;

  const quickState = getQuickDateState(dateStr);
  if (quickState.dateStatus === 'manual-holiday') {
    state.excludedHolidays.delete(dateStr);
    showToast(`已恢复排班：${dateStr}`);
  } else if (quickState.dateStatus === 'manual-workday') {
    state.manualWorkdays.delete(dateStr);
    showToast(`已恢复初始状态：${dateStr}`);
  } else if (quickState.dateStatus === 'weekend') {
    state.manualWorkdays.add(dateStr);
    showToast(`已将 ${dateStr} 设为调休排班！`, '<span class="material-symbols-outlined text-[16px]!" aria-hidden="true">task_alt</span>');
  } else {
    state.excludedHolidays.add(dateStr);
    showToast(`已将 ${dateStr} 设为跳过放假`, '<span class="material-symbols-outlined text-[16px]!" aria-hidden="true">block</span>');
  }

  rerenderActiveCalendar();
}

// 按当前模式重新渲染对应的月历
function rerenderActiveCalendar() {
  if (state.mode === 'editOld') {
    renderEditCalendar();
  } else {
    renderStep4Calendar();
  }
}

// 渲染排除与补班的标签栏
function renderExcludedAndManualTags() {
  const hasItems = (state.excludedHolidays.size > 0 || state.manualWorkdays.size > 0);
  if (!hasItems) {
    elements.excludedTagsContainer.classList.add('hidden');
    return;
  }

  elements.excludedTagsContainer.classList.remove('hidden');

  let tagsHtml = '';

  const sortedHolidays = Array.from(state.excludedHolidays).sort();
  sortedHolidays.forEach(dateStr => {
    const d = parseDate(dateStr);
    const wk = weekdayName(d.getDay());
    tagsHtml += `
      <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-s-chip-red-bg0 border border-s-chip-red-border text-white text-xs font-mono shadow-s-card-sm">
        <span class="inline-flex items-center gap-1"><span class="material-symbols-outlined text-[14px]!" aria-hidden="true">block</span>${displayDate(dateStr)} (${wk}) ${'休'}</span>
        <button type="button" onclick="removeHolidayTag('${dateStr}')" class="active:text-white/70 ml-1 inline-flex leading-none" title="${'撤销放假'}"><span class="material-symbols-outlined text-[14px]!" aria-hidden="true">close</span></button>
      </span>
    `;
  });

  const sortedManual = Array.from(state.manualWorkdays).sort();
  sortedManual.forEach(dateStr => {
    const d = parseDate(dateStr);
    const wk = weekdayName(d.getDay());
    tagsHtml += `
      <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-s-chip-yellow-bg border border-s-chip-yellow-border text-white text-xs font-mono shadow-s-card-sm">
        <span class="inline-flex items-center gap-1"><span class="material-symbols-outlined text-[14px]!" aria-hidden="true">task_alt</span>${displayDate(dateStr)} (${wk}) ${'补班'}</span>
        <button type="button" onclick="removeManualWorkdayTag('${dateStr}')" class="active:text-white/70 ml-1 inline-flex leading-none" title="${'撤销补班'}"><span class="material-symbols-outlined text-[14px]!" aria-hidden="true">close</span></button>
      </span>
    `;
  });

  elements.excludedTagsList.innerHTML = tagsHtml;
}

function removeHolidayTag(dateStr) {
  if (validateScheduleDateSelection(dateStr)) return;
  state.excludedHolidays.delete(dateStr);
  showToast(`已恢复排班：${dateStr}`);
  rerenderActiveCalendar();
}

function removeManualWorkdayTag(dateStr) {
  if (validateScheduleDateSelection(dateStr)) return;
  state.manualWorkdays.delete(dateStr);
  showToast(`已撤销补班：${dateStr}`);
  rerenderActiveCalendar();
}

// 已注释：查找单日卡片已移除（见 index.html），三个 handler 不再被任何事件绑定调用
/*
function handleQuickSetHoliday() {
  const val = elements.calendarQuickDateInput.value;
  if (!val) {
    showToast('请先选择日期', '<span class="material-symbols-outlined text-[16px]!" aria-hidden="true">warning</span>');
    return;
  }
  if (validateScheduleDateSelection(val)) return;
  const quickState = getQuickDateState(val);
  if (!quickState.allowedActions.holiday) {
    showToast(quickState.dateStatus === 'manual-holiday' ? ('该日期已是手动节假日') : ('默认排班日期不能设为调休补班'), '<span class="material-symbols-outlined text-[16px]!" aria-hidden="true">warning</span>');
    return;
  }

  state.manualWorkdays.delete(val);
  state.excludedHolidays.add(val);
  renderStep4Calendar();
  showToast(`已将 ${val} 设为跳过放假`, '<span class="material-symbols-outlined text-[16px]!" aria-hidden="true">block</span>');
  elements.calendarQuickDateInput.value = '';
  updateQuickDateState();
}

function handleQuickSetWorkday() {
  const val = elements.calendarQuickDateInput.value;
  if (!val) {
    showToast('请先选择日期', '<span class="material-symbols-outlined text-[16px]!" aria-hidden="true">warning</span>');
    return;
  }
  if (validateScheduleDateSelection(val)) return;
  const quickState = getQuickDateState(val);
  if (!quickState.allowedActions.workday) {
    showToast(quickState.dateStatus === 'default-workday' ? ('默认排班日期无需调休补班') : ('双休日不能设为手动节假日'), '<span class="material-symbols-outlined text-[16px]!" aria-hidden="true">warning</span>');
    return;
  }

  state.excludedHolidays.delete(val);
  state.manualWorkdays.add(val);
  renderStep4Calendar();
  showToast(`已将 ${val} 设为调休排班！`, '<span class="material-symbols-outlined text-[16px]!" aria-hidden="true">task_alt</span>');
  elements.calendarQuickDateInput.value = '';
  updateQuickDateState();
}

function handleQuickResetDate() {  const val = elements.calendarQuickDateInput.value;
  if (!val) {
    showToast('请先选择日期', '<span class="material-symbols-outlined text-[16px]!" aria-hidden="true">warning</span>');
    return;
  }
  if (validateScheduleDateSelection(val)) return;

  const quickState = getQuickDateState(val);
  if (!quickState.allowedActions.reset) {
    showToast('该日期已是初始状态', '<span class="material-symbols-outlined text-[16px]!" aria-hidden="true">warning</span>');
    return;
  }

  state.excludedHolidays.delete(val);
  state.manualWorkdays.delete(val);
  renderStep4Calendar();
  showToast(`已恢复初始状态：${val}`);
  elements.calendarQuickDateInput.value = '';
  updateQuickDateState();
}
*/

// ----------------------------------------------------
// 步骤 5：最终结果输出与可视化表格搜索（默认第1视图）
// ----------------------------------------------------

function renderFinalSchedule() {
  const totalDays = state.scheduleAssignments.totalDays;
  const { workdays } = computeScheduleDates(
    state.startDateStr,
    totalDays,
    state.excludedHolidays,
    state.manualWorkdays
  );

  state.finalScheduleItems = workdays.map((wd, idx) => ({
    dateStr: wd.dateStr,
    weekday: wd.weekday,
    isManualWorkday: wd.isManualWorkday,
    names: state.scheduleAssignments.dailyAssignments[idx]
  }));

  // 生成 Markdown
  state.markdownText = formatToMarkdown(state.finalScheduleItems);
  elements.markdownOutput.value = state.markdownText;
  autosizeMarkdownTextarea(elements.markdownOutput);

  // 渲染可视化表格（默认无筛选）
  renderFilterableTable('');
}

  // 文本视图 textarea 全高展示：随内容展开，由网页滚动条滚动（容器隐藏时 scrollHeight 不准，需在显示后同步）
  function autosizeMarkdownTextarea(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  // 视图切换辅助函数（Smartisan 分段 Tab：选中段加 is-active，内凹灰底白字）
  function setScheduleView(viewMode) {
    state.visualSubView = viewMode;
    const isTextView = viewMode === 'text';
    const isCardsView = viewMode === 'cards';
    const els = getActiveViewEls();

    els.tabs.cards.classList.toggle('is-active', isCardsView);
    els.tabs.cards.setAttribute('aria-selected', String(isCardsView));
    els.tabs.table.classList.toggle('is-active', viewMode === 'table');
    els.tabs.table.setAttribute('aria-selected', String(viewMode === 'table'));
    els.tabs.text.classList.toggle('is-active', isTextView);
    els.tabs.text.setAttribute('aria-selected', String(isTextView));

  els.cards.classList.toggle('hidden', !isCardsView);
  els.tableScroll.classList.toggle('hidden', viewMode !== 'table');
  els.text.classList.toggle('hidden', !isTextView);
  if (isTextView) {
    els.empty.classList.add('hidden');
    requestAnimationFrame(() => autosizeMarkdownTextarea(els.markdown));
  }
}

// 渲染支持搜索过滤的可视化排班（同时渲染卡片与表格）
function renderFilterableTable(query = '') {
  query = (query || '').trim().toLowerCase();
  const { items: scheduleItems } = getActiveScheduleData();
  const els = getActiveViewEls();

  // 查询中的空格归一化为中心点，带空格输入同样命中
  const normalizedQuery = query.replace(/\s+/g, '·');

  const filteredItems = scheduleItems.filter(item => {
    if (!query) return true;
    // 日期匹配：原文（YYYY-MM-DD）与展示形式（英文月份缩写）均可命中
    if (item.dateStr.toLowerCase().includes(query)) return true;
    if (displayDate(item.dateStr).toLowerCase().includes(query)) return true;
    if (item.weekday.toLowerCase().includes(query)) return true;
    return item.names.some(name => name.toLowerCase().includes(normalizedQuery));
  });

  if (query) {
    els.btnClear.classList.remove('hidden');
    els.stats.innerHTML = `共找到 <b class="text-s-blue-400 font-bold">${filteredItems.length}</b> 天（匹配 “${query}”）`;
  } else {
    els.btnClear.classList.add('hidden');
    els.stats.textContent = `共 ${scheduleItems.length} 天`;
  }

  if (state.visualSubView === 'text') {
    els.empty.classList.add('hidden');
    return;
  }

  if (filteredItems.length === 0) {
    els.tableBody.innerHTML = '';
    els.cards.innerHTML = '';
    els.empty.classList.remove('hidden');
    return;
  }

  els.empty.classList.add('hidden');

  // 1. 渲染电脑端表格行
  const rowsHtml = filteredItems.map((item, idx) => {
    const dateDisplay = highlightMatch(displayDate(item.dateStr), query);
    const weekdayDisplay = highlightMatch(item.weekday, query);

    const namesHtml = item.names.map(name => {
      const isMatch = query && name.toLowerCase().includes(normalizedQuery);
      const highlightedName = highlightMatch(name, normalizedQuery);
      return `<span class="inline-block cursor-pointer px-2 py-0.5 rounded-md text-xs font-medium mr-1.5 my-0.5 border ${isMatch ? 'bg-s-chip-yellow-bg border-s-chip-yellow-border text-s-chip-yellow-text font-bold' : 'bg-s-grey-100 border-s-grey-400 text-s-grey-900 active:bg-s-blue-100 active:text-s-blue-400'}" onclick="setTableSearch('${name}')" title="${'点击筛选此人排班'}">${highlightedName}</span>`;
    }).join('，');

    const badge = item.isManualWorkday
      ? '<span class="text-[10px] font-bold text-white bg-s-chip-yellow-bg px-1.5 py-0.5 rounded ml-1.5">' + ('补') + '</span>'
      : '';

    return `
      <tr class="active:bg-s-blue-100/30">
        <td class="py-2.5 px-4 font-mono text-s-grey-600">${idx + 1}</td>
        <td class="py-2.5 px-4 font-medium font-mono text-s-grey-900 flex items-center">${dateDisplay} ${badge}</td>
        <td class="py-2.5 px-4 text-s-grey-800 font-medium">${weekdayDisplay}</td>
        <td class="py-2.5 px-4">${namesHtml}</td>
      </tr>
    `;
  }).join('');
  els.tableBody.innerHTML = rowsHtml;

  // 2. 渲染手机端卡片流
  const cardsHtml = filteredItems.map((item, idx) => {
    const dateDisplay = highlightMatch(displayDate(item.dateStr), query);
    const weekdayDisplay = highlightMatch(item.weekday, query);

    const cardChipsHtml = item.names.map(name => {
      const isMatch = query && name.toLowerCase().includes(normalizedQuery);
      const highlightedName = highlightMatch(name, normalizedQuery);
      return `<span class="mobile-person-chip inline-block cursor-pointer px-2.5 py-1 rounded-lg text-xs font-medium border ${isMatch ? 'bg-s-chip-yellow-bg border-s-chip-yellow-border text-s-chip-yellow-text font-bold' : 'bg-s-grey-100 border-s-grey-400 text-s-grey-900 active:bg-s-blue-100 active:text-s-blue-400'}" onclick="setTableSearch('${name}')" title="${'点击筛选此人排班'}">${highlightedName}</span>`;
    }).join('');

    const badge = item.isManualWorkday
      ? '<span class="text-[10px] font-bold text-white bg-s-chip-yellow-bg px-1.5 py-0.5 rounded ml-1">' + ('补班') + '</span>'
      : '';

    return `
      <div class="schedule-card bg-white rounded-s-md border border-s-grey-400 p-3 shadow-s-card-sm">
        <div class="flex items-center justify-between border-b border-s-grey-200 pb-2 mb-2">
          <div class="flex items-center space-x-2">
            <span class="text-xs font-bold text-s-grey-600 font-mono bg-s-grey-100 px-1.5 py-0.5 rounded">${`第 ${idx + 1} 天`}</span>
            <span class="text-xs sm:text-sm font-bold text-s-grey-900 font-mono">${dateDisplay}</span>
            ${badge}
          </div>
          <span class="text-xs font-semibold ${isWeekendName(item.weekday) ? 'text-s-chip-yellow-text' : 'text-s-grey-800'}">${weekdayDisplay}</span>
        </div>
        <div class="flex flex-wrap items-center gap-1.5">
          ${cardChipsHtml}
        </div>
      </div>
    `;
  }).join('');
  els.cards.innerHTML = cardsHtml;
}

function highlightMatch(text, query) {
  if (!query) return text;
  const regex = new RegExp(`(${escapeRegExp(query)})`, 'gi');
  return text.replace(regex, '<mark class="search-highlight">$1</mark>');
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function setTableSearch(keyword) {
  getActiveViewEls().search.value = keyword;
  renderFilterableTable(keyword);
}

// 复制 Markdown 到剪贴板
function copyMarkdownToClipboard() {
  const { markdown } = getActiveScheduleData();
  if (!markdown) return;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(markdown).then(() => {
      showToast('排班表 Markdown 已成功复制到剪贴板！');
    }).catch(() => {
      fallbackCopyText(markdown);
    });
  } else {
    fallbackCopyText(markdown);
  }
}

function fallbackCopyText(text) {
  getActiveViewEls().markdown.select();
  document.execCommand('copy');
  showToast('排班表 Markdown 已成功复制到剪贴板！');
}

// 导出前延迟：显示"正在思考..."气泡并等待 1 秒（配合各导出函数的防重锁避免时间戳冲突）
async function thinkBeforeExport() {
  showToast('正在思考...', '');
  await new Promise(resolve => setTimeout(resolve, 1000));
}

// 导出并下载排班表 CSV 文件 (带 BOM 防止 Excel 乱码)
// 与 HTML 导出一致：文件名为 sched_<Unix 时间戳>.csv，确认后延迟 1 秒再导出
let isExportingCsv = false;

async function downloadCsvFile() {
  if (isExportingCsv) return;
  const { items } = getActiveScheduleData();
  if (!items || items.length === 0) return;

  const message = '导出 CSV 前请注意：\n• 打开后若日期显示为一行井号 "#"，需自行加宽单元格列宽；\n• CSV 不支持格式的保存，故您需要自行另存为 xlsx 等格式。\n\n是否继续导出？';
  if (!(await confirmDialog(message))) return;

  isExportingCsv = true;
  try {
    await thinkBeforeExport();

    const csvContent = formatToCsv(items);
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const fileName = `sched_${Date.now()}.csv`;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(`导出成功`);
  } finally {
    isExportingCsv = false;
  }
}

/**
 * 生成独立的单文件 HTML 可视化排班表
 * 纯内联样式与脚本，无外部 CDN 依赖，双击即可直接在任何浏览器完美离线打开
 */
function generateStandaloneHtml(items, stats) {
  const itemsJson = JSON.stringify(items);
  const statsJson = JSON.stringify(stats);
  const markdownText = formatToMarkdown(items);
  const markdownJson = JSON.stringify(markdownText);
  const title = `排班表 (${stats.startDate} 至 ${stats.endDate})`;
  const footerHtml = renderMarkdownFooter(siteFooterMarkdown);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "Smartisan Compact", "Inter", -apple-system, BlinkMacSystemFont, "Noto Sans CJK SC",
        "Source Han Sans SC", "Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei",
        "Helvetica Neue", Arial, sans-serif;
      background-color: #f5f5f5;
      color: #333333;
      line-height: 1.5;
      padding: 16px 12px;
    }
    @media (min-width: 640px) {
      body { padding: 32px 16px; }
    }
    .container {
      max-width: 1024px;
      margin: 0 auto;
    }
    .header {
      background: #ffffff;
      border: 0.8px solid #e2e2e2;
      border-radius: 10px;
      padding: 16px;
      margin-bottom: 16px;
      box-shadow: 0 10px 16px rgba(0,0,0,0.04);
    }
    @media (min-width: 640px) {
      .header { padding: 24px; margin-bottom: 24px; }
    }
    .header-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 16px;
    }
    .title {
      font-size: 20px;
      font-weight: 700;
      color: #636363;
    }
    @media (min-width: 640px) {
      .title { font-size: 24px; }
    }
    .subtitle {
      font-size: 12px;
      color: #7f7f7f;
      margin-top: 2px;
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .btn-csv {
      background: linear-gradient(180deg, #ffffff, #fcfcfc);
      color: #636363;
      border: 0.8px solid #eeeeee;
      padding: 8px 14px;
      font-size: 12px;
      font-weight: 600;
      border-radius: 6px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-family: inherit;
    }
    .btn-csv:active {
      background: linear-gradient(180deg, #ebebeb, #f2f2f2);
    }
    .btn-print {
      background: linear-gradient(180deg, #5b87eb, #5883eb);
      color: #ffffff;
      border: 0.8px solid #3f68e2;
      padding: 8px 14px;
      font-size: 12px;
      font-weight: 600;
      border-radius: 6px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-family: inherit;
    }
    .btn-print:active {
      background: #4772e6;
      border-color: #2f54d7;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
    }
    @media (min-width: 640px) {
      .stats-grid { grid-template-columns: repeat(4, 1fr); gap: 12px; }
    }
    .stat-card {
      background: #ffffff;
      border: 0.8px solid #e2e2e2;
      border-radius: 10px;
      padding: 10px 12px;
      text-align: center;
      box-shadow: 0 2px 6px rgba(0,0,0,0.06);
    }
    .stat-label {
      font-size: 11px;
      color: #7f7f7f;
      font-weight: 500;
      margin-bottom: 2px;
    }
    .stat-value {
      font-size: 18px;
      font-weight: 800;
      color: #636363;
    }
    @media (min-width: 640px) {
      .stat-value { font-size: 20px; }
    }
    .table-container {
      background: #ffffff;
      border: 0.8px solid #e2e2e2;
      border-radius: 10px;
      overflow: hidden;
      box-shadow: 0 10px 16px rgba(0,0,0,0.04);
    }
    .toolbar {
      padding: 12px 16px;
      background: #fafafa;
      border-bottom: 0.8px solid #e2e2e2;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
    }
    .search-wrapper {
      position: relative;
      flex: 1;
      min-width: 200px;
      max-width: 420px;
    }
    .search-input {
      width: 100%;
      padding: 8px 30px 8px 32px;
      border: 0.8px solid #e2e2e2;
      border-radius: 6px;
      font-size: 13px;
      color: #333333;
      font-family: inherit;
      outline: none;
      box-shadow: inset 0 4px 4px rgba(0,0,0,0.04);
      transition: border-color 0.2s;
    }
    .search-input::placeholder { color: #d9d9d9; }
    /* 原生日期选择器：浏览器自带，min/max 锁定排班区间；
       仅显示日历图标（文字透明 + 固定窄宽），点击即弹原生日历 */
    .date-input {
      width: 36px;
      height: 34px;
      padding: 0;
      border: 0.8px solid #e2e2e2;
      border-radius: 6px;
      font-size: 13px;
      color: transparent;
      background: #ffffff;
      outline: none;
      box-shadow: inset 0 4px 4px rgba(0,0,0,0.04);
      cursor: pointer;
      color-scheme: light;
    }
    /* 原生图标在移动端可能不渲染，隐藏后用自带 SVG 日历图标覆盖代替 */
    .date-input::-webkit-calendar-picker-indicator {
      opacity: 0;
      position: absolute;
      width: 34px;
      height: 32px;
      cursor: pointer;
    }
    .date-input-icon {
      position: absolute;
      right: 2px;
      top: 50%;
      transform: translateY(-50%);
      width: 16px;
      height: 16px;
      color: #636363;
      pointer-events: none; /* 点击穿透到日期输入框 */
    }
    .date-input-wrapper { position: relative; display: inline-flex; }
    .date-input:focus { border-color: #93b2f7; }
    .search-input:focus {
      border-color: #93b2f7;
    }
    .search-icon {
      position: absolute;
      left: 10px;
      top: 50%;
      transform: translateY(-50%);
      color: #929292;
      font-size: 13px;
      pointer-events: none;
      display: inline-flex;
    }
    /* 内嵌 SVG 图标（Material Symbols Outlined 路径），currentColor 继承文字色 */
    .search-icon svg, .btn-clear svg { width: 14px; height: 14px; display: block; }
    .btn-csv svg, .btn-print svg, .btn-copy svg { width: 14px; height: 14px; display: block; }
    .empty-state svg { width: 28px; height: 28px; display: inline-block; }
    .app-toast svg { width: 15px; height: 15px; display: block; }
    .btn-clear {
      position: absolute;
      right: 8px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      color: #929292;
      cursor: pointer;
      display: none;
      padding: 4px;
      font-family: inherit;
    }
    .btn-clear:active { color: #636363; }
    .toolbar-right {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .toolbar-info {
      font-size: 12px;
      color: #636363;
    }
    .toolbar-info b { color: #5079d9; }
    /* Smartisan 分段 Tab：选中段内凹灰底白字 */
    .view-toggle {
      display: inline-flex;
      border: 0.4px solid #e2e2e2;
      border-radius: 6px;
      overflow: hidden;
    }
    .view-btn {
      border: none;
      background: #ffffff;
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 700;
      color: #636363;
      cursor: pointer;
      font-family: inherit;
    }
    .view-btn + .view-btn { border-left: 0.4px solid #f2f2f2; }
    .view-btn.active {
      background: #b2b2b2;
      color: #ffffff;
      box-shadow: inset 0 4px 10px rgba(0,0,0,0.06), inset 0 0 0 0.4px #a7a7a7;
    }
    .copy-wrapper {
      position: absolute;
      top: 12px;
      right: 12px;
      z-index: 15;
    }
    .btn-copy {
      height: 36px;
      border: 0.8px solid #3f68e2;
      border-radius: 6px;
      background: linear-gradient(180deg, #5b87eb, #5883eb);
      color: #ffffff;
      padding: 0 12px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-family: inherit;
    }
    .btn-copy:active {
      background: #4772e6;
      border-color: #2f54d7;
    }
    .markdown-wrapper {
      position: relative;
      overflow: visible;
      background: #333333;
      border-top: 0.8px solid #e2e2e2;
      display: block;
    }
    .markdown-output {
      display: block;
      width: 100%;
      height: auto;
      min-height: 400px;
      padding: 44px 56px 16px 16px;
      background: transparent;
      color: #fafafa;
      border: none;
      outline: none;
      resize: none;
      overflow: hidden;
      font-family: Consolas, "Courier New", "Microsoft YaHei", "PingFang SC", "Noto Sans SC", monospace, sans-serif;
      font-size: 13px;
      line-height: 1.65;
    }
    .markdown-output.copy-success {
      box-shadow: inset 0 0 0 2px #ccb08c;
    }
    /* Smartisan Toast：暖黄渐变底 + 棕字 */
    .app-toast {
      position: fixed;
      top: 20px;
      left: 50%;
      z-index: 60;
      pointer-events: none;
      display: flex;
      align-items: center;
      gap: 8px;
      border: 0.8px solid #d2b89c;
      border-radius: 6px;
      background: linear-gradient(180deg, #fcf6e6, #fcf3dc);
      color: #ad8a67;
      padding: 10px 16px;
      font-size: 13px;
      font-weight: 500;
      box-shadow: 0 4px 4px rgba(0,0,0,0.08);
      opacity: 0;
      transform: translate(-50%, -16px);
      transition: opacity 0.3s, transform 0.3s;
    }
    .app-toast.visible {
      opacity: 1;
      transform: translate(-50%, 0);
    }
    /* 卡片样式 */
    .cards-wrapper {
      padding: 12px;
      background: #fafafa;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .card-item {
      background: #ffffff;
      border: 0.8px solid #e2e2e2;
      border-radius: 10px;
      padding: 12px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.06);
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 0.8px solid #f2f2f2;
      padding-bottom: 8px;
      margin-bottom: 8px;
    }
    .card-title-left {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .card-day-num {
      font-size: 11px;
      font-weight: 700;
      color: #7f7f7f;
      background: #fafafa;
      border: 0.4px solid #e2e2e2;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: Consolas, "Courier New", "Microsoft YaHei", "PingFang SC", "Noto Sans SC", monospace, sans-serif;
    }
    .card-date-text {
      font-size: 13px;
      font-weight: 700;
      color: #333333;
      font-family: Consolas, "Courier New", "Microsoft YaHei", "PingFang SC", "Noto Sans SC", monospace, sans-serif;
    }
    .card-weekday-text {
      font-size: 12px;
      font-weight: 600;
      color: #636363;
    }
    .card-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .mobile-person-chip {
      display: inline-block;
      background: #fafafa;
      color: #646464;
      border: 0.4px solid #cecece;
      border-radius: 100px;
      padding: 4px 12px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      user-select: none;
      touch-action: manipulation;
      font-family: inherit;
    }
    .mobile-person-chip:active {
      background: linear-gradient(180deg, #e6efff, #e1ecff);
      color: #6393ff;
      border-color: #93b2f7;
    }
    .mobile-person-chip.active-match {
      background: #fff5d9;
      color: #cd9143;
      border-color: #ccb08c;
      font-weight: 700;
    }
    /* 表格样式 */
    .table-wrapper {
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 13px;
      min-width: 480px;
    }
    th {
      background: #fafafa;
      color: #7f7f7f;
      font-weight: 600;
      padding: 10px 14px;
      border-bottom: 0.8px solid #e2e2e2;
      position: sticky;
      top: 0;
      z-index: 5;
    }
    td {
      padding: 10px 14px;
      border-bottom: 0.8px solid #f2f2f2;
      vertical-align: middle;
    }
    tr:nth-child(even) { background-color: #fafafa; }
    tr:active { background-color: #fafafa; }
    .person-chip {
      display: inline-block;
      background: #fafafa;
      color: #646464;
      border: 0.4px solid #cecece;
      border-radius: 4px;
      padding: 2px 8px;
      margin: 2px 4px 2px 0;
      font-weight: 500;
      font-size: 12px;
      cursor: pointer;
      font-family: inherit;
    }
    .person-chip:active {
      background: linear-gradient(180deg, #e6efff, #e1ecff);
      color: #6393ff;
      border-color: #93b2f7;
    }
    .person-chip.active-match {
      background: #fff5d9;
      color: #cd9143;
      border-color: #ccb08c;
      font-weight: 700;
    }
    /* 补班徽章：Chip 黄 */
    .badge-makeup {
      font-size: 10px;
      font-weight: 700;
      color: #cd9143;
      background: #fff5d9;
      border: 0.4px solid #ccb08c;
      padding: 2px 6px;
      border-radius: 4px;
      margin-left: 6px;
    }
    mark.highlight {
      background-color: #fff5d9;
      color: #cd9143;
      padding: 1px 3px;
      border-radius: 3px;
      font-weight: 700;
    }
    .empty-state {
      padding: 48px 16px;
      text-align: center;
      color: #9d9d9d;
      font-size: 14px;
      display: none;
    }
    .site-footer {
      margin-top: 24px;
      border-top: 0.8px solid #e2e2e2;
      background-color: #ffffff;
      padding: 12px 12px;
      text-align: center;
    }
    .site-footer-content {
      max-width: 1024px;
      margin: 0 auto;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      gap: 8px;
      font-size: 13px;
      line-height: 1.5;
      color: #636363;
    }
    .site-footer-content p {
      margin: 0;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .site-footer-content .site-footer-line {
      flex-basis: 100%;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .site-footer-content a {
      color: #5079d9;
      text-decoration: none;
    }
    .hidden { display: none !important; }
    @media print {
      body { background: #ffffff; padding: 0; }
      .header { border: none; box-shadow: none; padding: 0 0 16px 0; }
      .btn-print, .btn-csv, .header-actions, .toolbar, .cards-wrapper, .view-toggle, .markdown-wrapper { display: none !important; }
      .table-wrapper { display: block !important; max-height: none; overflow: visible; }
      .table-container { border: 0.8px solid #cccccc; box-shadow: none; }
      th, td { border-bottom: 0.8px solid #cccccc; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="header-top">
        <div>
          <div class="title">排班表</div>
          <div class="subtitle">排班区间：${stats.startDate} 至 ${stats.endDate} <br> 点击人名亦可快速筛选。</div>
        </div>
        <div class="header-actions">
          <button class="btn-csv" onclick="downloadCsv()"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width="1em" height="1em"><path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 2v3h-4V5h4zM8 19H5v-3h3v3zm0-5H5v-4h3v4zm0-6V5h3v3H8zm5 11h-3v-3h3v3zm0-5h-3v-4h3v4zm0-6V5h3v3h-3zm6 11h-4v-3h4v3zm0-5h-4v-4h4v4z"/></svg><span>表格</span></button>
          <button class="btn-print" onclick="window.print()"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width="1em" height="1em"><path d="M19 8H5a3 3 0 0 0-3 3v6h4v4h12v-4h4v-6a3 3 0 0 0-3-3zm-3 11H8v-5h8v5zm3-7a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm-1-9H6v4h12V3z"/></svg><span>PDF</span></button>
        </div>
      </div>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">总参与人数</div>
          <div class="stat-value">${stats.totalPeople} 人</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">每日值班人数</div>
          <div class="stat-value">${stats.dailyPeople} 人</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">排班总天数</div>
          <div class="stat-value">${stats.totalDays} 天整</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">每人轮值次数</div>
          <div class="stat-value">${stats.shiftsPerPerson} 次</div>
        </div>
      </div>
    </div>

    <div class="table-container">
      <div class="toolbar">
        <div class="search-wrapper">
          <span class="search-icon"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width="1em" height="1em"><path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 0 0 1.48-5.34c-.47-2.78-2.79-5-5.59-5.34a6.505 6.505 0 0 0-7.27 7.27c.34 2.8 2.56 5.12 5.34 5.59a6.5 6.5 0 0 0 5.34-1.48l.27.28v.79l4.25 4.25c.41.41 1.08.41 1.49 0 .41-.41.41-1.08 0-1.49L15.5 14zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg></span>
          <input type="text" id="searchInput" class="search-input" placeholder="输入姓名、日期或星期搜索...">
          <button id="btnClear" class="btn-clear" onclick="clearSearch()" aria-label="清空搜索"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width="1em" height="1em"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></button>
        </div>
        <div class="toolbar-right">
          <div class="date-input-wrapper">
            <input type="date" id="dateJumpInput" class="date-input" min="${stats.startDate}" max="${stats.endDate}" aria-label="跳转日期" title="选择排班日期快速跳转">
            <svg class="date-input-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 16H5V10h14v10zM5 8V6h14v2H5z"/></svg>
          </div>
          <div id="statsInfo" class="toolbar-info">共 ${items.length} 天</div>
          <div class="view-toggle">
            <button id="btnCards" class="view-btn" onclick="setViewMode('cards')">卡片</button>
            <button id="btnTable" class="view-btn" onclick="setViewMode('table')">表格</button>
            <button id="btnText" class="view-btn" onclick="setViewMode('text')">文本</button>
          </div>
        </div>
      </div>

      <!-- 手机端卡片流容器 -->
      <div id="cardsWrapper" class="cards-wrapper"></div>

      <!-- 电脑端表格容器 -->
      <div id="tableWrapper" class="table-wrapper hidden">
        <table>
          <thead>
            <tr>
              <th style="width: 60px;">序号</th>
              <th style="width: 130px;">日期</th>
              <th style="width: 80px;">星期</th>
              <th>值班人员</th>
            </tr>
          </thead>
          <tbody id="tableBody"></tbody>
        </table>
      </div>

      <div id="emptyState" class="empty-state">
        <div style="margin-bottom: 8px; color: #929292; display: flex; justify-content: center;"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width="1em" height="1em"><path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 0 0 1.48-5.34c-.47-2.78-2.79-5-5.59-5.34a6.505 6.505 0 0 0-7.27 7.27c.34 2.8 2.56 5.12 5.34 5.59a6.5 6.5 0 0 0 5.34-1.48l.27.28v.79l4.25 4.25c.41.41 1.08.41 1.49 0 .41-.41.41-1.08 0-1.49L15.5 14zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg></div>
        未找到与关键词匹配的排班记录
      </div>

      <div id="markdownWrapper" class="markdown-wrapper">
        <div class="copy-wrapper">
          <button id="btnCopy" class="btn-copy" onclick="copyMarkdown()" aria-label="复制 Markdown 文本" title="复制 Markdown 文本"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width="1em" height="1em"><path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/></svg><span>复制</span></button>
        </div>
        <textarea id="markdownOutput" class="markdown-output" readonly></textarea>
      </div>
    </div>
  </div>

  <footer class="site-footer" aria-label="页脚">
    <div id="footerContent" class="site-footer-content"></div>
  </footer>

  <div id="appToast" class="app-toast">
    <span style="display: inline-flex;"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width="1em" height="1em"><path d="M9.55 18.2 3.8 12.45l1.45-1.45 4.3 4.3 9.05-9.05 1.45 1.45z"/></svg></span>
    <span id="appToastMessage">操作成功</span>
  </div>

  <script>
    const scheduleData = ${itemsJson};
    const statsData = ${statsJson};
    // 日期展示：中文保持 YYYY-MM-DD
    function displayDate(dateStr) { return String(dateStr || ''); }
    const markdownText = ${markdownJson};
    let currentView = window.innerWidth < 640 ? 'cards' : 'table';

    const searchInput = document.getElementById('searchInput');
    const btnClear = document.getElementById('btnClear');
    const tableBody = document.getElementById('tableBody');
    const cardsWrapper = document.getElementById('cardsWrapper');
    const tableWrapper = document.getElementById('tableWrapper');
    const btnCards = document.getElementById('btnCards');
    const btnTable = document.getElementById('btnTable');
    const btnText = document.getElementById('btnText');
    const statsInfo = document.getElementById('statsInfo');
    const emptyState = document.getElementById('emptyState');
    const markdownWrapper = document.getElementById('markdownWrapper');
    const markdownOutput = document.getElementById('markdownOutput');
    const btnCopy = document.getElementById('btnCopy');
    const appToast = document.getElementById('appToast');
    const appToastMessage = document.getElementById('appToastMessage');

    function escapeHtml(str) {
      return String(str).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[m]);
    }

    function escapeReg(str) {
      return str.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
    }

    function highlight(text, query) {
      if (!query) return escapeHtml(text);
      const reg = new RegExp('(' + escapeReg(query) + ')', 'gi');
      return escapeHtml(text).replace(reg, '<mark class="highlight">$1</mark>');
    }

    function setViewMode(mode) {
      currentView = mode;
      btnCards.className = mode === 'cards' ? 'view-btn active' : 'view-btn';
      btnTable.className = mode === 'table' ? 'view-btn active' : 'view-btn';
      btnText.className = mode === 'text' ? 'view-btn active' : 'view-btn';
      cardsWrapper.classList.toggle('hidden', mode !== 'cards');
      tableWrapper.classList.toggle('hidden', mode !== 'table');
      markdownWrapper.classList.toggle('hidden', mode !== 'text');
      if (mode === 'text') emptyState.style.display = 'none';
    }

    function render(query = '') {
      query = query.trim().toLowerCase();
      btnClear.style.display = query ? 'block' : 'none';

      // 查询中的空格归一化为中心点（人名存储形式如 Lando·Norris）
      const normalizedQuery = query.replace(/\\s+/g, '·');
      const filtered = scheduleData.filter(item => {
        if (!query) return true;
        // 日期匹配：按 YYYY-MM-DD 原文命中
        if (item.dateStr.toLowerCase().includes(query)) return true;
        if (displayDate(item.dateStr).toLowerCase().includes(query)) return true;
        if (item.weekday.toLowerCase().includes(query)) return true;
        return item.names.some(name => name.toLowerCase().includes(normalizedQuery));
      });

      if (query) {
        statsInfo.innerHTML = '共找到 <b>' + filtered.length + '</b> 天（匹配 “' + escapeHtml(query) + '”）';
      } else {
        statsInfo.textContent = '共 ' + scheduleData.length + ' 天';
      }

      if (currentView === 'text') {
        emptyState.style.display = 'none';
        return;
      }

      if (filtered.length === 0) {
        tableBody.innerHTML = '';
        cardsWrapper.innerHTML = '';
        emptyState.style.display = 'block';
        return;
      }
      emptyState.style.display = 'none';

      let tableHtml = '';
      let cardsHtml = '';

      filtered.forEach((item, idx) => {
        const makeupBadge = item.isManualWorkday ? '<span class="badge-makeup">' + '补' + '</span>' : '';
        const makeupCardBadge = item.isManualWorkday ? '<span class="badge-makeup">' + '补班' + '</span>' : '';

        // 表格行
        const tableNamesHtml = item.names.map(name => {
          const isMatch = query && name.toLowerCase().includes(normalizedQuery);
          return '<span class="person-chip ' + (isMatch ? 'active-match' : '') + '" data-name="' + escapeHtml(name) + '" title="' + '点击筛选' + '">' + highlight(name, normalizedQuery) + '</span>';
        }).join('，');

        tableHtml += '<tr>' +
          '<td style="color: #9d9d9d; font-family: Consolas, \\\'Microsoft YaHei\\\', \\\'PingFang SC\\\', \\\'Noto Sans SC\\\', monospace, sans-serif;">' + (idx + 1) + '</td>' +
          '<td style="color: #333333; font-weight: 600; font-family: Consolas, \\\'Microsoft YaHei\\\', \\\'PingFang SC\\\', \\\'Noto Sans SC\\\', monospace, sans-serif;">' + highlight(displayDate(item.dateStr), query) + makeupBadge + '</td>' +
          '<td style="color: #7f7f7f;">' + highlight(item.weekday, query) + '</td>' +
          '<td>' + tableNamesHtml + '</td>' +
        '</tr>';

        // 卡片项
        const cardChipsHtml = item.names.map(name => {
          const isMatch = query && name.toLowerCase().includes(normalizedQuery);
          return '<span class="mobile-person-chip ' + (isMatch ? 'active-match' : '') + '" data-name="' + escapeHtml(name) + '" title="点击筛选">' + highlight(name, normalizedQuery) + '</span>';
        }).join('');

        cardsHtml += '<div class="card-item">' +
          '<div class="card-header">' +
            '<div class="card-title-left">' +
              '<span class="card-day-num">' + '第 ' + (idx + 1) + ' 天' + '</span>' +
              '<span class="card-date-text">' + highlight(displayDate(item.dateStr), query) + '</span>' +
              makeupCardBadge +
            '</div>' +
            '<span class="card-weekday-text">' + highlight(item.weekday, query) + '</span>' +
          '</div>' +
          '<div class="card-chips">' + cardChipsHtml + '</div>' +
        '</div>';
      });

      tableBody.innerHTML = tableHtml;
      cardsWrapper.innerHTML = cardsHtml;
    }

    function filterByName(name) {
      searchInput.value = name;
      render(name);
    }

    let copyFeedbackTimer = null;
    function copyMarkdown() {
      markdownOutput.value = markdownText;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(markdownText).then(showCopySuccess).catch(fallbackCopy);
      } else {
        fallbackCopy();
      }
    }

    function fallbackCopy() {
      markdownOutput.focus();
      markdownOutput.select();
      document.execCommand('copy');
      showCopySuccess();
    }

    function showCopySuccess() {
      markdownOutput.classList.add('copy-success');
      appToastMessage.textContent = '排班表 Markdown 已成功复制到剪贴板！';
      appToast.classList.add('visible');
      clearTimeout(copyFeedbackTimer);
      copyFeedbackTimer = setTimeout(function() {
        markdownOutput.classList.remove('copy-success');
        appToast.classList.remove('visible');
      }, 2200);
    }

    function clearSearch() {
      searchInput.value = '';
      render('');
      searchInput.focus();
    }

    // 原生日期选择器跳转：日期被 min/max 锁定在排班区间内；
    // 区间内不存在的日期（节假日等无班次日）报错并复位
    function toast(msg) {
      appToastMessage.textContent = msg;
      appToast.classList.add('visible');
      clearTimeout(copyFeedbackTimer);
      copyFeedbackTimer = setTimeout(function() {
        appToast.classList.remove('visible');
      }, 2200);
    }

    var dateJumpInput = document.getElementById('dateJumpInput');
    if (dateJumpInput) {
      dateJumpInput.addEventListener('change', function() {
        var val = dateJumpInput.value;
        if (!val) return;
        var hit = scheduleData.find(function(item) { return item.dateStr === val; });
        if (!hit) {
          toast('该日期无排班记录');
          dateJumpInput.value = '';
          return;
        }
        filterByName(val);
      });
      // 部分移动端浏览器点击日期输入不弹选择器，用 showPicker() 兜底
      dateJumpInput.addEventListener('click', function() {
        if (typeof dateJumpInput.showPicker === 'function') {
          try { dateJumpInput.showPicker(); } catch (err) { /* 无用户手势等场景忽略 */ }
        }
      });
    }

    document.addEventListener('click', function(e) {
      const chip = e.target.closest('.person-chip, .mobile-person-chip');
      if (chip && chip.dataset.name) {
        filterByName(chip.dataset.name);
      }
    });

    searchInput.addEventListener('input', function(e) { render(e.target.value); });

    function downloadCsv() {
      const confirmMessage = '导出 CSV 前请注意：\\n• 打开后若日期显示为一行井号 \"#\"，需自行加宽单元格列宽；\\n• CSV 不支持格式的保存，故您需要自行另存为 xlsx 等格式。\\n\\n是否继续导出？';
      if (!window.confirm(confirmMessage)) return;
      const maxNames = scheduleData.reduce(function(m, item) { return Math.max(m, (item.names || []).length); }, 0);
      const headers = ['序号', '日期', '星期', '排班名单'];
      if (maxNames > 1) {
        for (let i = 1; i <= maxNames; i++) {
          headers.push('人员' + i);
        }
      }

      const rows = scheduleData.map(function(item, index) {
        const seq = index + 1;
        const date = item.dateStr;
        const weekday = item.weekday;
        const names = item.names || [];
        const namesStr = names.join('，');
        const safeNames = '"' + namesStr.replace(/"/g, '""') + '"';
        const row = [seq, date, weekday, safeNames];

        if (maxNames > 1) {
          for (let i = 0; i < maxNames; i++) {
            const n = names[i] || '';
            row.push('"' + n.replace(/"/g, '""') + '"');
          }
        }
        return row.join(',');
      });

      const csvContent = [headers.join(','), ...rows].join('\\r\\n');
      const blob = new Blob(['\\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const fileName = 'sched_' + Date.now() + '.csv';
      link.setAttribute('download', fileName);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }

    setViewMode(currentView);
    render('');
    markdownOutput.value = markdownText;

    // 文本视图不使用 textarea 内部滚动条：随内容完全展开，由网页滚动条滚动
    function autosizeMarkdownOutput() {
      markdownOutput.style.height = 'auto';
      markdownOutput.style.height = markdownOutput.scrollHeight + 'px';
    }
    markdownOutput.addEventListener('input', autosizeMarkdownOutput);
    // 初次及每次切入文本视图时同步高度（容器隐藏时 scrollHeight 不准）
    var _origSetViewMode = setViewMode;
    setViewMode = function(mode) {
      _origSetViewMode(mode);
      if (mode === 'text') requestAnimationFrame(autosizeMarkdownOutput);
    };
    requestAnimationFrame(autosizeMarkdownOutput);

    var footerContent = document.getElementById('footerContent');
    if (footerContent) footerContent.innerHTML = ${JSON.stringify(footerHtml)};
  </script>
</body>
</html>`;
}

// 导出并下载独立可视化 HTML 文件：文件名为 sched_<Unix 时间戳>.html，
// 导出前延迟 1 秒并提示"正在思考..."，期间加锁防止重复触发导致时间戳冲突
let isExportingHtml = false;

async function downloadHtmlFile() {
  if (isExportingHtml) return;
  const { items } = getActiveScheduleData();
  if (!items || items.length === 0) return;

  const startDate = items[0]?.dateStr || '';
  const endDate = items[items.length - 1]?.dateStr || '';

  let stats;
  if (state.mode === 'editOld') {
    //  顺延自旧排班表：由生成结果反推统计指标
    const peopleSet = new Set();
    let dailyPeople = 0;
    items.forEach(item => {
      item.names.forEach(n => peopleSet.add(n));
      dailyPeople = Math.max(dailyPeople, item.names.length);
    });
    const totalShifts = items.reduce((sum, item) => sum + item.names.length, 0);
    stats = {
      totalPeople: peopleSet.size,
      dailyPeople,
      totalDays: items.length,
      shiftsPerPerson: items.length > 0 ? Math.round(totalShifts / peopleSet.size) : 0,
      startDate,
      endDate
    };
  } else {
    stats = {
      totalPeople: state.names.length,
      dailyPeople: state.dailyCount,
      totalDays: state.scheduleAssignments.totalDays,
      shiftsPerPerson: state.scheduleAssignments.shiftsPerPerson,
      startDate,
      endDate
    };
  }

  isExportingHtml = true;
  try {
    await thinkBeforeExport();

    const htmlContent = generateStandaloneHtml(items, stats);
    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const fileName = `sched_${Date.now()}.html`;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(`导出成功`);
  } finally {
    isExportingHtml = false;
  }
}

// ----------------------------------------------------
//  顺延自旧排班表：五步流程（导入旧表 → 检查日期 → 选择日期 → 假期调整 → 成功生成）
// ----------------------------------------------------

// 步骤跳转控制（?editStep=1~5，与新流程 ?step=0~5 互不冲突）
function goToEditStep(targetStep) {
  if (targetStep < 1 || targetStep > 5) return;
  const edit = state.editOld;

  // 进入旧表流程：切换模式并备份新流程的假期设置（仅首次）
  if (state.mode !== 'editOld') {
    state.mode = 'editOld';
    savedNewHolidays = state.excludedHolidays;
    savedNewWorkdays = state.manualWorkdays;
  }

  // 逐步前置校验
  if (targetStep >= 2 && edit.importedItems.length === 0) {
    showToast('请先成功导入旧排班表', '<span class="material-symbols-outlined text-[16px]!" aria-hidden="true">warning</span>');
    return;
  }
  if (targetStep >= 3) {
    if (!edit.executedThrough) {
      showToast('请先选择已执行截止日期', '<span class="material-symbols-outlined text-[16px]!" aria-hidden="true">warning</span>');
      return;
    }
    if (edit.remainingItems.length === 0) {
      showToast('没有剩余需要重新编排的班次', '<span class="material-symbols-outlined text-[16px]!" aria-hidden="true">warning</span>');
      return;
    }
  }

  // 进入第 2 步：渲染导入内容卡片（无内容时容器保持隐藏）
  if (targetStep === 2) {
    renderEditImportedCards();
  }

  // 进入第 4 步（假期调整）：清空共享假期集合，日历定位到新起始日期所在月
  if (targetStep === 4) {
    if (!edit.newStartDate) {
      edit.newStartDate = getTodayDateStr();
      elements.editNewStartDateInput.value = edit.newStartDate;
    }
    state.excludedHolidays.clear();
    state.manualWorkdays.clear();
    const startD = parseDate(edit.newStartDate);
    state.calViewYear = startD.getFullYear();
    state.calViewMonth = startD.getMonth();
    renderEditCalendar();
  }

  // 进入第 5 步：生成新排班并渲染结果视图
  if (targetStep === 5) {
    if (!generateEditFinalSchedule()) return;
    elements.editMarkdownOutput.value = edit.markdownText;
    autosizeMarkdownTextarea(elements.editMarkdownOutput);
    renderFilterableTable('');
    setScheduleView(state.visualSubView);
  }

  // 更新面板可见性（同时隐藏新流程面板）
  elements.editPanels.forEach((panel, i) => {
    if (!panel) return;
    if (i === targetStep) {
      panel.classList.remove('hidden');
    } else {
      panel.classList.add('hidden');
    }
  });
  elements.panels.forEach(p => p && p.classList.add('hidden'));

  state.currentStep = targetStep;
  updateTopBar();
  // 将当前步骤同步到网址参数：仅用 ?editStep=N 表示旧表流程，同时清除 step（两参数互斥），其余参数保留
  const params = new URLSearchParams(location.search);
  params.delete('step');
  params.set('editStep', targetStep);
  history.replaceState(null, '', `${location.pathname}?${params.toString()}`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// 生成新的排班结果：剩余班次按原顺序映射到新起始日期之后的工作日
function generateEditFinalSchedule() {
  const edit = state.editOld;
  const { workdays } = computeScheduleDates(
    edit.newStartDate,
    edit.remainingItems.length,
    state.excludedHolidays,
    state.manualWorkdays
  );

  // 假期设置可能导致可用工作日不足，需阻断并提示
  if (workdays.length < edit.remainingItems.length) {
    showToast(`可用工作日不足：需要 ${edit.remainingItems.length} 天，仅找到 ${workdays.length} 天，请检查假期设置`, '<span class="material-symbols-outlined text-[16px]!" aria-hidden="true">warning</span>');
    return false;
  }

  edit.finalItems = workdays.map((wd, i) => ({
    dateStr: wd.dateStr,
    weekday: wd.weekday,
    isManualWorkday: wd.isManualWorkday,
    names: edit.remainingItems[i].names
  }));
  edit.markdownText = formatToMarkdown(edit.finalItems);
  return true;
}

// 第 1 步：导入 CSV 文件（读取为文本后走统一解析入口）
function handleEditImportFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    elements.editImportTextarea.value = String(reader.result || '');
    handleEditParseText();
  };
  reader.onerror = () => showToast('文件读取失败，请重试', '<span class="material-symbols-outlined text-[16px]!" aria-hidden="true">error</span>');
  reader.readAsText(file, 'UTF-8');
  // 清空 input.value 以便再次选择同一文件时仍能触发 change
  event.target.value = '';
}

// 第 1 步：解析文本框内容（自动识别 Markdown / CSV）
function handleEditParseText() {
  const text = elements.editImportTextarea.value;
  const result = parseOldRoster(text);

  if (result.errors.length > 0) {
    elements.editImportError.innerHTML = `
      <div class="font-bold flex items-center space-x-1.5 text-red-900 mb-1">${'解析发现问题：'}</div>
      <ul class="list-disc list-inside space-y-0.5 font-mono">${result.errors.map(err => `<li>${err}</li>`).join('')}</ul>
    `;
    elements.editImportError.classList.remove('hidden');
  } else {
    elements.editImportError.classList.add('hidden');
    elements.editImportError.innerHTML = '';
  }

  if (result.items.length === 0) {
    showToast('解析失败，请检查内容格式', '<span class="material-symbols-outlined text-[16px]!" aria-hidden="true">error</span>');
    return false;
  }

  state.editOld.importedItems = result.items;
  // 导入内容变化后，此前的截止日选择不再可靠，重置后续状态
  state.editOld.executedThrough = '';
  state.editOld.remainingItems = [];
  state.editOld.finalItems = [];
  elements.editExecutedThroughInput.value = '';
  elements.editExecutedWeekdayTag.textContent = '';
  elements.editStatRemaining.textContent = '';
  // 截止日期选择器范围：下限 = 导入第一天（至少已执行 1 天），上限 = 倒数第二天（至少保留 1 天待编排），非法日期直接不展示
  elements.editExecutedThroughInput.min = result.items[0].dateStr;
  elements.editExecutedThroughInput.max = result.items.length >= 2 ? result.items[result.items.length - 2].dateStr : '';

  if (result.warnings.length > 0) {
    showToast(`成功解析 ${result.items.length} 天（含 ${result.warnings.length} 条警告）`, '<span class="material-symbols-outlined text-[16px]!" aria-hidden="true">warning</span>');
  } else {
    showToast(`成功解析 ${result.items.length} 天排班记录！`);
  }
  return true;
}

// 第 1 步「继续」：先解析输入内容，成功才进入第 2 步
function handleEditToStep2() {
  if (!handleEditParseText()) return;
  goToEditStep(2);
}

// 第 2 步：渲染导入的旧排班卡片视图，已执行日期置灰并标注；无导入内容时隐藏容器
function renderEditImportedCards() {
  const edit = state.editOld;
  const total = edit.importedItems.length;
  elements.editImportedCardsContainer.classList.toggle('hidden', total === 0);
  if (total === 0) return;

  const executedCount = edit.executedThrough
    ? edit.importedItems.filter(item => item.dateStr <= edit.executedThrough).length
    : 0;
  const remaining = total - executedCount;

  if (edit.executedThrough) {
    elements.editStatRemaining.innerHTML = `导入原 <b class="text-s-blue-400">${total}</b> 天；<br>
      已执行 <b class="text-s-grey-600">${executedCount}</b> 天；<br>
      剩余 <b class="text-s-blue-400">${remaining}</b> 天待编排。`;
  } else {
    elements.editStatRemaining.textContent = `共 ${total} 天 · 请选择已执行截止日期`;
  }

  elements.editImportedCardsContainer.innerHTML = edit.importedItems.map((item, idx) => {
    const isExecuted = edit.executedThrough && item.dateStr <= edit.executedThrough;
    const executedBadge = isExecuted
      ? `<span class="text-[10px] font-bold text-s-grey-600 bg-s-grey-200 px-1.5 py-0.5 rounded">${'已执行'}</span>`
      : `<span class="text-[10px] font-bold text-s-chip-yellow-text bg-s-chip-yellow-bg px-1.5 py-0.5 rounded">${`剩余 第 ${idx - executedCount + 1} 班`}</span>`;
    const cardClass = isExecuted ? 'opacity-50 bg-s-grey-100' : 'bg-white';
    const weekdayColor = isWeekendName(item.weekday) ? 'text-s-chip-yellow-text' : 'text-s-grey-800';

    return `
      <div class="schedule-card rounded-s-md border border-s-grey-400 p-3 shadow-s-card-sm ${cardClass}">
        <div class="flex items-center justify-between border-b border-s-grey-200 pb-2 mb-2">
          <div class="flex items-center space-x-2">
            <span class="text-xs font-bold text-s-grey-600 font-mono bg-s-grey-100 px-1.5 py-0.5 rounded">${`第 ${idx + 1} 天`}</span>
            <span class="text-xs sm:text-sm font-bold text-s-grey-900 font-mono">${displayDate(item.dateStr)}</span>
            ${executedBadge}
          </div>
          <span class="text-xs font-semibold ${weekdayColor}">${item.weekday}</span>
        </div>
        <div class="flex flex-wrap items-center gap-1.5">
          ${item.names.map(name =>
            `<span class="inline-block px-2.5 py-1 rounded-lg text-xs font-medium border bg-s-grey-100 border-s-grey-400 text-s-grey-900">${name}</span>`
          ).join('')}
        </div>
      </div>
    `;
  }).join('');
}

// 第 2 步：已执行截止日变化（含该天）
function handleEditExecutedThroughChange() {
  const val = elements.editExecutedThroughInput.value;
  if (!val) return;
  const edit = state.editOld;

  // 至少已执行 1 天：不允许早于导入列表的第一天
  const firstDate = edit.importedItems[0]?.dateStr;
  if (firstDate && val < firstDate) {
    elements.editExecutedThroughInput.value = '';
    edit.executedThrough = '';
    edit.remainingItems = [];
    elements.editExecutedWeekdayTag.innerHTML = '';
    elements.editStatRemaining.textContent = '请选择已执行截止日期';
    renderEditImportedCards();
    elements.editImportError.innerHTML = `已执行截止日期不能早于导入排班的第一天（${firstDate}）：至少需要已执行 1 天。`;
    elements.editImportError.classList.remove('hidden');
    showToast('已执行截止日期过早，至少需已执行 1 天', '<span class="material-symbols-outlined text-[16px]!" aria-hidden="true">warning</span>');
    return;
  }

  // 至少保留 1 天待编排：不允许晚于导入列表的倒数第二天
  const lastSelectable = edit.importedItems.length >= 2 ? edit.importedItems[edit.importedItems.length - 2].dateStr : '';
  if (lastSelectable && val > lastSelectable) {
    elements.editExecutedThroughInput.value = '';
    edit.executedThrough = '';
    edit.remainingItems = [];
    elements.editExecutedWeekdayTag.innerHTML = '';
    elements.editStatRemaining.textContent = '请选择已执行截止日期';
    renderEditImportedCards();
    elements.editImportError.innerHTML = `已执行截止日期不能晚于导入排班的倒数第二天（${lastSelectable}）：至少需要保留 1 天待编排。`;
    elements.editImportError.classList.remove('hidden');
    showToast('已执行截止日期过晚，至少需保留 1 天待编排', '<span class="material-symbols-outlined text-[16px]!" aria-hidden="true">warning</span>');
    return;
  }

  elements.editImportError.classList.add('hidden');
  elements.editImportError.innerHTML = '';
  edit.executedThrough = val;

  const date = parseDate(val);
  elements.editExecutedWeekdayTag.innerHTML = `已执行截止日为 <span class="text-s-blue-400 font-semibold">${weekdayName(date.getDay())}</span>，<br>该天及之前的班次将被忽略。`;

  // 字符串比较对 YYYY-MM-DD 即为时间顺序
  state.editOld.remainingItems = state.editOld.importedItems.filter(item => item.dateStr > val);
  renderEditImportedCards();
}

// 第 3 步：新起始日期变化
function handleEditNewStartDateChange() {
  const val = elements.editNewStartDateInput.value;
  if (!val) return;
  state.editOld.newStartDate = val;

  const date = parseDate(val);
  const dayOfWeek = date.getDay();
  const weekday = weekdayName(dayOfWeek);
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    elements.editNewWeekdayTag.innerHTML = `
      <span class="text-s-chip-yellow-text font-bold">该日为 ${weekday}（非工作日）</span>，排班将从最近的工作日或调休补班日开始。
    `;
  } else {
    elements.editNewWeekdayTag.innerHTML = `
      起始日为 <span class="text-s-blue-400 font-semibold">${weekday}</span>（工作日）。
    `;
  }

  const startD = parseDate(val);
  state.calViewYear = startD.getFullYear();
  state.calViewMonth = startD.getMonth();
  // 起始日期变化后，合法选择区间随之变化，清理超出范围的假期记录
  pruneScheduleDateSelections(val, '9999-12-31');
  renderEditCalendar();
}

// 旧表流程的日历合法区间：从新起始日期到最后一班（上不封顶地扫描）
function getEditScheduleDateRange() {
  const edit = state.editOld;
  const { workdays } = computeScheduleDates(
    edit.newStartDate || getTodayDateStr(),
    edit.remainingItems.length + 1,
    state.excludedHolidays,
    state.manualWorkdays
  );
  const allowed = workdays.slice(0, edit.remainingItems.length);
  const fallback = edit.newStartDate || getTodayDateStr();
  return {
    start: fallback,
    end: allowed.length > 0 ? allowed[allowed.length - 1].dateStr : fallback
  };
}

// 第 3 步：渲染假期修改月历（镜像 renderStep4Calendar，作用于旧表流程）
function renderEditCalendar() {
  const edit = state.editOld;
  const totalDays = edit.remainingItems.length;

  // 渲染前强制清掉超出当前合法区间的选择
  const renderRange = getEditScheduleDateRange();
  pruneScheduleDateSelections(renderRange.start, renderRange.end);

  // 扫描结束日的后一天，确保非法补班日期也能获得日历状态
  const { workdays, datesMap } = totalDays > 0
    ? computeScheduleDates(edit.newStartDate, totalDays + 1, state.excludedHolidays, state.manualWorkdays)
    : { workdays: [], datesMap: new Map() };

  /*
  if (totalDays > 0 && workdays.length >= totalDays) {
    elements.editCalStatRangeStart.textContent = renderRange.start.replaceAll('-', '/');
    elements.editCalStatRangeEnd.textContent = renderRange.end.replaceAll('-', '/');
  } else {
    elements.editCalStatRangeStart.textContent = '-';
    elements.editCalStatRangeEnd.textContent = '-';
  }
  */

  renderEditExcludedAndManualTags();

  const year = state.calViewYear;
  const month = state.calViewMonth;
  elements.editCalendarMonthTitle.textContent = `${year}/${String(month + 1).padStart(2, '0')}`;

  renderMonthGrid(year, month, datesMap, renderRange, elements.editCalendarGrid);
}

// 渲染旧表流程的排除与补班标签栏
function renderEditExcludedAndManualTags() {
  const hasItems = (state.excludedHolidays.size > 0 || state.manualWorkdays.size > 0);
  if (!hasItems) {
    elements.editExcludedTagsContainer.classList.add('hidden');
    return;
  }

  elements.editExcludedTagsContainer.classList.remove('hidden');

  let tagsHtml = '';
  Array.from(state.excludedHolidays).sort().forEach(dateStr => {
    const d = parseDate(dateStr);
    const wk = weekdayName(d.getDay());
    tagsHtml += `
      <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-s-chip-red-bg0 border border-s-chip-red-border text-white text-xs font-mono shadow-s-card-sm">
        <span class="inline-flex items-center gap-1"><span class="material-symbols-outlined text-[14px]!" aria-hidden="true">block</span>${displayDate(dateStr)} (${wk}) ${'休'}</span>
        <button type="button" onclick="removeHolidayTag('${dateStr}')" class="active:text-white/70 ml-1 inline-flex leading-none" title="${'撤销放假'}"><span class="material-symbols-outlined text-[14px]!" aria-hidden="true">close</span></button>
      </span>
    `;
  });
  Array.from(state.manualWorkdays).sort().forEach(dateStr => {
    const d = parseDate(dateStr);
    const wk = weekdayName(d.getDay());
    tagsHtml += `
      <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-s-chip-yellow-bg border border-s-chip-yellow-border text-white text-xs font-mono shadow-s-card-sm">
        <span class="inline-flex items-center gap-1"><span class="material-symbols-outlined text-[14px]!" aria-hidden="true">task_alt</span>${displayDate(dateStr)} (${wk}) ${'补班'}</span>
        <button type="button" onclick="removeManualWorkdayTag('${dateStr}')" class="active:text-white/70 ml-1 inline-flex leading-none" title="${'撤销补班'}"><span class="material-symbols-outlined text-[14px]!" aria-hidden="true">close</span></button>
      </span>
    `;
  });

  elements.editExcludedTagsList.innerHTML = tagsHtml;
}

// 旧表流程"重新开始"：清空全部旧表状态并回到第 1 步
function resetEditOldFlow() {
  state.editOld.importedItems = [];
  state.editOld.executedThrough = '';
  state.editOld.remainingItems = [];
  state.editOld.newStartDate = '';
  state.editOld.finalItems = [];
  state.editOld.markdownText = '';
  elements.editImportTextarea.value = '';
  elements.editExecutedThroughInput.value = '';
  elements.editNewStartDateInput.value = '';
  elements.editExecutedWeekdayTag.textContent = '';
  elements.editNewWeekdayTag.textContent = '';
  elements.editStatRemaining.textContent = '';
  elements.editImportError.classList.add('hidden');
  goToEditStep(1);
}

// 绑定各事件监听
function setupEventListeners() {
  // Step 1: 名单与人数输入
  elements.namesInput.addEventListener('input', handleStep1Inputs);
  elements.dailyCountInput.addEventListener('input', handleStep1Inputs);

  elements.btnLoadSample.addEventListener('click', () => {
    elements.namesInput.value = SAMPLE_NAMES_TEXT;
    handleStep1Inputs();
    showToast('成功');
  });

  elements.btnClearNames.addEventListener('click', () => {
    elements.namesInput.value = '';
    handleStep1Inputs();
    showToast('成功');
  });

  elements.btnDecreaseDaily.addEventListener('click', () => {
    let cur = parseInt(elements.dailyCountInput.value, 10) || 4;
    if (cur > 1) {
      elements.dailyCountInput.value = cur - 1;
      handleStep1Inputs();
    }
  });

  elements.btnIncreaseDaily.addEventListener('click', () => {
    let cur = parseInt(elements.dailyCountInput.value, 10) || 4;
    elements.dailyCountInput.value = cur + 1;
    handleStep1Inputs();
  });

  // 顶部导航条上一步/下一步
  elements.topBtnBack.addEventListener('click', () => topBackTarget && topBackTarget());
  elements.topBtnNext.addEventListener('click', () => topNextTarget && topNextTarget());

  // Step 2: 标签切换与重新打乱（Smartisan 分段 Tab：选中段加 is-active）
  elements.tabStep2Days.addEventListener('click', () => {
    elements.tabStep2Days.classList.add('is-active');
    elements.tabStep2Days.setAttribute('aria-selected', 'true');
    elements.tabStep2People.classList.remove('is-active');
    elements.tabStep2People.setAttribute('aria-selected', 'false');
    elements.schedulePreviewList.classList.remove('hidden');
    elements.schedulePersonStatsList.classList.add('hidden');
  });

  elements.tabStep2People.addEventListener('click', () => {
    elements.tabStep2People.classList.add('is-active');
    elements.tabStep2People.setAttribute('aria-selected', 'true');
    elements.tabStep2Days.classList.remove('is-active');
    elements.tabStep2Days.setAttribute('aria-selected', 'false');
    elements.schedulePersonStatsList.classList.remove('hidden');
    elements.schedulePreviewList.classList.add('hidden');
  });

  elements.btnEditAssignments.addEventListener('click', openEditAssignmentsModal);
  elements.btnCloseEditModal.addEventListener('click', closeEditAssignmentsModal);
  elements.btnCancelEditModal.addEventListener('click', closeEditAssignmentsModal);
  elements.btnResetEditModal.addEventListener('click', resetEditAssignmentsModal);
  elements.btnSaveEditModal.addEventListener('click', saveEditAssignmentsModal);
  elements.modalEditAssignments.addEventListener('click', (e) => {
    if (e.target === elements.modalEditAssignments) {
      closeEditAssignmentsModal();
    }
  });

  elements.btnReshuffle.addEventListener('click', () => {
    generateAssignments();
    showToast('成功', '<span class="material-symbols-outlined text-[16px]!" aria-hidden="true">check</span>');
  });

  // Step 3: 开始日期
  elements.startDateInput.addEventListener('change', handleStartDateChange);

  // Step 4: 月历选择器交互（查找单日卡片已注释）
  // elements.calendarQuickDateInput.addEventListener('change', updateQuickDateState);

  elements.btnPrevMonth.addEventListener('click', () => {
    state.calViewMonth--;
    if (state.calViewMonth < 0) {
      state.calViewMonth = 11;
      state.calViewYear--;
    }
    renderStep4Calendar();
  });

  elements.btnNextMonth.addEventListener('click', () => {
    state.calViewMonth++;
    if (state.calViewMonth > 11) {
      state.calViewMonth = 0;
      state.calViewYear++;
    }
    renderStep4Calendar();
  });

  elements.btnJumpStartMonth.addEventListener('click', () => {
    const startD = parseDate(state.startDateStr || getTodayDateStr());
    state.calViewYear = startD.getFullYear();
    state.calViewMonth = startD.getMonth();
    renderStep4Calendar();
  });

  elements.btnJumpEndMonth.addEventListener('click', () => {
    const totalDays = state.scheduleAssignments.totalDays;
    const { workdays } = computeScheduleDates(state.startDateStr, totalDays, state.excludedHolidays, state.manualWorkdays);
    if (workdays.length > 0) {
      const endD = workdays[workdays.length - 1].date;
      state.calViewYear = endD.getFullYear();
      state.calViewMonth = endD.getMonth();
      renderStep4Calendar();
    }
  });

  /*
  elements.btnCalClearAll.addEventListener('click', () => {
    state.excludedHolidays.clear();
    state.manualWorkdays.clear();
    renderStep4Calendar();
    showToast('成功重置');
  });

  elements.btnQuickSetHoliday.addEventListener('click', handleQuickSetHoliday);
  elements.btnQuickSetWorkday.addEventListener('click', handleQuickSetWorkday);
  elements.btnQuickResetDate.addEventListener('click', handleQuickResetDate);
  */

  // Step 5: 搜索、切换视图与导出
  elements.tableSearchInput.addEventListener('input', (e) => {
    renderFilterableTable(e.target.value);
  });

  elements.btnClearTableSearch.addEventListener('click', () => {
    elements.tableSearchInput.value = '';
    renderFilterableTable('');
  });

  elements.btnDownloadHtml.addEventListener('click', downloadHtmlFile);
  elements.btnDownloadCsv.addEventListener('click', downloadCsvFile);
  elements.btnCopyMarkdown.addEventListener('click', copyMarkdownToClipboard);

  // 视图切换：卡片 / 表格 / 文本
  elements.btnSubviewCards.addEventListener('click', () => setScheduleView('cards'));
  elements.btnSubviewTable.addEventListener('click', () => setScheduleView('table'));
  elements.btnSubviewText.addEventListener('click', () => setScheduleView('text'));

  // 步骤 5 底部「重新开始」按钮已移除，重置逻辑统一走顶部导航条右上角刷新按钮

  // ----------------------------------------------------
  //  顺延自旧排班表流程
  // ----------------------------------------------------
  elements.btnEditImportFile.addEventListener('click', () => elements.editImportFileInput.click());
  elements.btnEditLoadSample.addEventListener('click', () => {
    elements.editImportTextarea.value = SAMPLE_ROSTER_MD_ZH;
    handleEditParseText();
  });
  elements.btnEditClearImport.addEventListener('click', () => {
    elements.editImportTextarea.value = '';
    // 清空即回到未导入状态：隐藏解析错误，不触发空文本报错
    elements.editImportError.classList.add('hidden');
    elements.editImportError.innerHTML = '';
    state.editOld.importedItems = [];
    state.editOld.executedThrough = '';
    state.editOld.remainingItems = [];
    state.editOld.finalItems = [];
    elements.editExecutedThroughInput.value = '';
    elements.editExecutedThroughInput.min = '';
    elements.editExecutedWeekdayTag.textContent = '';
    elements.editStatRemaining.textContent = '';
    elements.editImportedCardsContainer.classList.add('hidden');
    showToast('成功');
  });
  elements.editImportFileInput.addEventListener('change', handleEditImportFile);
  elements.editExecutedThroughInput.addEventListener('change', handleEditExecutedThroughChange);
  elements.editNewStartDateInput.addEventListener('change', handleEditNewStartDateChange);

  elements.btnEditPrevMonth.addEventListener('click', () => {
    state.calViewMonth--;
    if (state.calViewMonth < 0) {
      state.calViewMonth = 11;
      state.calViewYear--;
    }
    renderEditCalendar();
  });

  elements.btnEditNextMonth.addEventListener('click', () => {
    state.calViewMonth++;
    if (state.calViewMonth > 11) {
      state.calViewMonth = 0;
      state.calViewYear++;
    }
    renderEditCalendar();
  });

  elements.btnEditJumpStartMonth.addEventListener('click', () => {
    const startD = parseDate(state.editOld.newStartDate || getTodayDateStr());
    state.calViewYear = startD.getFullYear();
    state.calViewMonth = startD.getMonth();
    renderEditCalendar();
  });

  // 跳至结束月：定位到最后一班所在月份
  elements.btnEditJumpEndMonth.addEventListener('click', () => {
    const edit = state.editOld;
    if (edit.remainingItems.length === 0) return;
    const { workdays } = computeScheduleDates(
      edit.newStartDate || getTodayDateStr(),
      edit.remainingItems.length,
      state.excludedHolidays,
      state.manualWorkdays
    );
    if (workdays.length > 0) {
      const endD = parseDate(workdays[workdays.length - 1].dateStr);
      state.calViewYear = endD.getFullYear();
      state.calViewMonth = endD.getMonth();
      renderEditCalendar();
    }
  });

  /*
  elements.btnEditCalClearAll.addEventListener('click', () => {
    state.excludedHolidays.clear();
    state.manualWorkdays.clear();
    renderEditCalendar();
    showToast('成功重置');
  });
  */

  // 第 4 步：搜索、切换视图与导出（复用按模式取值接口）
  elements.editTableSearchInput.addEventListener('input', (e) => {
    renderFilterableTable(e.target.value);
  });

  elements.btnEditClearTableSearch.addEventListener('click', () => {
    elements.editTableSearchInput.value = '';
    renderFilterableTable('');
  });

  elements.btnEditDownloadHtml.addEventListener('click', downloadHtmlFile);
  elements.btnEditDownloadCsv.addEventListener('click', downloadCsvFile);
  elements.btnEditCopyMarkdown.addEventListener('click', copyMarkdownToClipboard);

  elements.btnEditSubviewCards.addEventListener('click', () => setScheduleView('cards'));
  elements.btnEditSubviewTable.addEventListener('click', () => setScheduleView('table'));
  elements.btnEditSubviewText.addEventListener('click', () => setScheduleView('text'));

  // ----------------------------------------------------
  // Smartisan Date Time Picker 弹窗：所有 [data-picker-field] 日期输入框共用
  // ----------------------------------------------------
  document.querySelectorAll('[data-picker-field]').forEach(input => {
    input.addEventListener('click', () => openDatePickerDialog({
      value: input.value ? input.value.replace(/\//g, '-') : getTodayDateStr(),
      min: input.getAttribute('min') || '',
      max: input.getAttribute('max') || '',
      title: input.dataset.pickerTitle || '',
      onConfirm: dateStr => {
        input.value = dateStr;
        input.dispatchEvent(new Event('change', { bubbles: false }));
      }
    }));
  });

  elements.btnPickerConfirm.addEventListener('click', confirmDatePickerDialog);
  elements.btnPickerCancel.addEventListener('click', closeDatePickerDialog);
  elements.modalDatePicker.addEventListener('click', e => {
    if (e.target === elements.modalDatePicker) closeDatePickerDialog();
  });
  [elements.pickerColYear, elements.pickerColMonth, elements.pickerColDay].forEach(col => {
    col.addEventListener('scroll', () => schedulePickerScrollSync(col));
  });
}

// 页面加载启动
document.addEventListener('DOMContentLoaded', () => {
  // 显示模式按钮：按 URL 参数同步图标与描述（主页才显示，显隐由 updateTopBar 控制）
  updateThemeModeButton();
  setupEventListeners();
  loadSiteFooter();

  document.addEventListener('click', (event) => {
    if (!elements.activeStepMenuAnchor) return;
    if (event.target.closest('.step-title-button')) return;
    // 点击弹窗内容（列表）不关闭；点击遮罩或页面其他区域关闭
    if (event.target.closest('.step-menu-list')) return;
    closeStepMenu(elements.activeStepMenuAnchor);
  });

  window.addEventListener('resize', () => {
    if (elements.activeStepMenuAnchor) closeStepMenu(elements.activeStepMenuAnchor);
  });

  window.addEventListener('scroll', (event) => {
    if (!elements.activeStepMenuAnchor) return;
    // 菜单列表自身的滚动不关闭弹窗
    if (event.target.closest && event.target.closest('.step-menu')) return;
    closeStepMenu(elements.activeStepMenuAnchor);
  });

  // 第 1 步初始为空，不预填示例名单（示例可通过“载入示例”按钮填入）
  elements.dailyCountInput.value = 4;
  handleStep1Inputs();

  // 默认预置今天为开始日期
  const todayStr = getTodayDateStr();
  state.startDateStr = todayStr;
  elements.startDateInput.value = todayStr;
  handleStartDateChange();

  // 每次进入网站默认从第 0 步（主页）开始；若网址带有合法参数则直接跳转对应步骤
  // ?editStep=1~5 为 顺延自旧排班表流程（导入数据不跨刷新保留，守卫会回落到第 1 步）
  // ?step=1~5 为新建排班流程
  const urlParams = new URLSearchParams(location.search);
  const urlEditStep = parseInt(urlParams.get('editStep'), 10);
  if (Number.isInteger(urlEditStep) && urlEditStep >= 1 && urlEditStep <= 5) {
    goToEditStep(urlEditStep);
  } else {
    const urlStep = parseInt(urlParams.get('step'), 10);
    if (Number.isInteger(urlStep) && urlStep >= 1 && urlStep <= 5) {
      goToStep(urlStep);
    } else {
      // 无参数默认主页：同步状态与顶栏（显示语言切换等），
      // 并清掉 URL 中残留的步骤参数，保证主页与 step/editStep 一一对应
      state.currentStep = 0;
      updateTopBar();
      if (urlParams.has('step') || urlParams.has('editStep')) {
        urlParams.delete('step');
        urlParams.delete('editStep');
        const qs = urlParams.toString();
        history.replaceState(null, '', qs ? `${location.pathname}?${qs}` : location.pathname);
      }
    }
  }
});
