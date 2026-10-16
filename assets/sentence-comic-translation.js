
const SENTENCE_TRANSLATION_LABELS = {
  subject: "who/what did the image describe?",
  action: "what happened?",
  modifier: "how/when/where/why this happened?",
};

// Reading callers supply persistence and navigation; review keeps its own contract.
function initializeReadingSentence({sentence, title, position, total, savedState, reference = null, onChange, onCheckpoint, onFinish, onNext, onBack, completedCount}) {
  const prompt = {sourceText: sentence, sourceLanguage: 'en', targetLanguage: 'zh',
    targetText: reference?.translation || '', semanticChunks: reference?.chunks || []};
  state.game = {mode: 'sentence-translation', isChineseToEnglish: false, prompts: [prompt], index: 0,
    status: 'method-choice', method: '', connectorSelection: new Set(), panels: [], activePanelIndex: null,
    activeQuestion: 'subject', selectedTokenIds: new Set(), subjectFinderOpen: false, subjectFinderTokenIds: new Set(),
    translationDraft: '', chunkOrder: [], chunkPunctuation: {}, connectorExtraTranslations: {}, manualPanelBoundaries: null, structureDraftBoundaries: [],
    manualConnectorSegments: [], structureDraftConnectors: [], structureEditorOpen: false,
    omittedConnectors: [], omittedConnectorEditorOpen: false, omittedConnectorDraftText: '', omittedConnectorDraftPosition: null,
    resultOpen: false, connectorHelpOpen: false, translationCollapsed: false};
  if (savedState) {
    for (const key of READING_ACTIVITY_FIELDS) if (key in savedState) state.game[key] = structuredClone(savedState[key]);
    for (const key of READING_ACTIVITY_SETS) state.game[key] = new Set(savedState[key] || []);
  }
  if (typeof ReadingClauses !== 'undefined') {
    ReadingClauses.reset();
    if (!savedState) state.game.clauseTree = ReadingClauses.create(sentence);
  }
  if (state.game.status === 'chunk-translate') state.game.status = 'panels';
  normalizeReadingPunctuation();
  state.game.reading = {title, position, total, onChange, onCheckpoint, onFinish, onNext, onBack, completedCount};
  renderSentenceTranslationActivity();
}

const READING_ACTIVITY_SETS = ['connectorSelection', 'selectedTokenIds', 'subjectFinderTokenIds'];
const READING_ACTIVITY_FIELDS = ['clauseTree', 'status', 'method', 'panels', 'activePanelIndex', 'activeQuestion',
  'subjectFinderOpen', 'translationDraft', 'chunkOrder', 'chunkPunctuation', 'connectorExtraTranslations', 'manualPanelBoundaries', 'structureDraftBoundaries',
  'manualConnectorSegments', 'structureDraftConnectors', 'structureEditorOpen', 'omittedConnectors',
  'omittedConnectorEditorOpen', 'omittedConnectorDraftText', 'omittedConnectorDraftPosition', 'connectorHelpOpen', 'translationCollapsed'];
function readingSentenceState() {
  const saved = {format_version: 1, tokenization_version: 1};
  for (const key of READING_ACTIVITY_FIELDS) saved[key] = structuredClone(state.game[key]);
  for (const key of READING_ACTIVITY_SETS) saved[key] = [...state.game[key]];
  return saved;
}

const FRONTED_SUBORDINATE_CONNECTORS = {
  en: new Set([
    "although",
    "though",
    "because",
    "when",
    "while",
    "if",
    "after",
    "before",
    "as",
    "as long as",
    "as soon as",
    "as if",
    "by the time",
    "in case",
    "lest",
    "once",
    "until",
    "whenever",
    "wherever",
    "whereas",
  ]),
  zh: new Set(["因為", "如果", "雖然", "當"]),
};

async function initializeSentenceComicTranslation(gameItems, mode) {
  const isChineseToEnglish = mode === "chinese-english-translation";
  document.title = isChineseToEnglish ? "Chinese to English Translation" : "English to Chinese Translation";
  document.body.classList.remove("decrypto-page");
  document.body.classList.remove("five-second-page");
  document.body.classList.remove("codename-page");
  document.body.classList.add("sentence-comic-page");
  document.querySelector("[data-five-second-back-setting]")?.remove();
  const heading = $(".activity-topbar h1");
  if (heading) heading.textContent = document.title;
  const nextStageButton = $("#activity-next-stage-button");
  if (nextStageButton) nextStageButton.classList.add("hidden");
  const stageBackButton = $("#activity-stage-back-button");
  if (stageBackButton) stageBackButton.classList.add("hidden");

  const backendAttempts = await sentenceTranslationBackendAttempts();
  const sessionSetNumbers = sentenceTranslationSessionSetNumbers(gameItems, mode, backendAttempts);
  const prompts = buildSentenceTranslationPrompts(gameItems, isChineseToEnglish, sessionSetNumbers);
  if (!prompts.length) {
    renderEmptyState("This activity needs stored example During sentences with English and Chinese translations.");
    return;
  }

  state.game = {
    mode,
    isChineseToEnglish,
    status: "method-choice",
    prompts,
    index: 0,
    method: "",
    sessionSetNumbers,
    sourceItems: gameItems,
    connectorSelection: new Set(),
    panels: [],
    activePanelIndex: null,
    activeQuestion: "subject",
    selectedTokenIds: new Set(),
    subjectFinderOpen: false,
    subjectFinderTokenIds: new Set(),
    translationDraft: "",
    resultOpen: false,
    askTeacherSaved: false,
    askTeacherHelpOpen: false,
    completionRecorded: false,
    connectorHelpOpen: false,
    translationCollapsed: false,
  };
  prepareSentenceTranslationPrompt();
}

function buildSentenceTranslationPrompts(gameItems, isChineseToEnglish, sessionSetNumbers = new Map()) {
  return gameItems.flatMap((entry) => {
    const targetForm = entry.content?.target_form || reviewWord(entry);
    const targetSetNumber = Number(sessionSetNumbers.get(String(entry.sessionId)) || 1);
    const sets = (entry.content?.sets || []).filter((set, setIndex) => Number(set.set_number || setIndex + 1) === targetSetNumber);
    return sets
      .map((set, setIndex) => {
        const during = set.during || {};
        const english = String(during.english || "").trim();
        const chinese = String(during.traditional_chinese || "").trim();
        if (!english || !chinese) return null;
        return {
          key: `${entry.key}:set:${set.set_number || setIndex + 1}`,
          entry,
          set,
          targetForm,
          sourceText: isChineseToEnglish ? chinese : english,
          targetText: isChineseToEnglish ? english : chinese,
          sourceLanguage: isChineseToEnglish ? "zh" : "en",
          targetLanguage: isChineseToEnglish ? "en" : "zh",
          semanticChunks: Array.isArray(during.semantic_chunks) ? during.semantic_chunks : [],
          ownerEditedText: isChineseToEnglish ? chinese : "",
        };
      })
      .filter(Boolean);
  });
}

function nextSentenceTranslationSetNumber(setNumber) {
  const normalized = Number(setNumber) || 1;
  return normalized >= 5 ? 1 : normalized + 1;
}

async function sentenceTranslationBackendAttempts() {
  try {
    const data = await api("/api/review-activity-attempts");
    return data.items || [];
  } catch (error) {
    throw Error(`Unable to load review history: ${error.message}`);
  }
}

function sentenceTranslationSessionSetNumbers(gameItems, mode, backendAttempts = []) {
  return new Map(
    [...new Set(gameItems.map((entry) => String(entry.sessionId)))].map((sessionId) => {
      const attempts = backendAttempts
        .filter((attempt) => attempt.activity_type === mode && String(attempt.session_id) === sessionId && !attempt.result?.ask_teacher)
        .sort((left, right) => String(right.completed_at || "").localeCompare(String(left.completed_at || "")));
      if (attempts.length) {
        const latestSetNumber = Number(attempts[0].set_number || attempts[0].result?.set_number || 1);
        return [sessionId, nextSentenceTranslationSetNumber(latestSetNumber)];
      }
      return [sessionId, 1];
    }),
  );
}

function currentSentencePrompt() {
  return state.game?.prompts?.[state.game.index] || null;
}

function prepareSentenceTranslationPrompt() {
  const game = state.game;
  const prompt = currentSentencePrompt();
  if (!game || !prompt) return;
  game.connectorSelection = new Set();
  game.panels = [];
  game.method = "";
  game.activePanelIndex = null;
  game.activeQuestion = "subject";
  game.selectedTokenIds = new Set();
  game.subjectFinderOpen = false;
  game.subjectFinderTokenIds = new Set();
  game.translationDraft = "";
  game.resultOpen = false;
  game.askTeacherSaved = false;
  game.askTeacherHelpOpen = false;
  game.connectorHelpOpen = false;
  game.translationCollapsed = false;
  game.status = "method-choice";
  renderSentenceTranslationActivity();
}

function sentenceTranslationTextForPanels() {
  const prompt = currentSentencePrompt();
  if (!prompt) return "";
  return state.game.isChineseToEnglish ? prompt.ownerEditedText || prompt.sourceText : prompt.sourceText;
}

function sentenceTranslationReviewOffset() {
  const params = new URLSearchParams(window.location.search);
  const offset = Number(params.get("review_offset"));
  return Number.isFinite(offset) ? offset : null;
}

function sentenceTranslationTokens(text, language) {
  const source = String(text || "");
  const englishWordPattern = String.raw`[A-Za-z]+(?:['’-][A-Za-z]+)*`;
  const pattern =
    language === "zh"
      ? new RegExp(`${englishWordPattern}|\\d+(?:\\.\\d+)?|[\\u4e00-\\u9fff]|[^\\s]`, "g")
      : new RegExp(`${englishWordPattern}|\\d+(?:\\.\\d+)?|[^\\s]`, "g");
  return (source.match(pattern) || []).map((text, index) => ({ id: index, text }));
}

function connectorCandidateIndexes(tokens, language) {
  const candidates = new Set();
  const connectorPhrases =
    language === "zh"
      ? [
          ["因為"],
          ["所以"],
          ["但是"],
          ["可是"],
          ["如果"],
          ["雖然"],
          ["當"],
          ["而且"],
          ["並且"],
          ["然後"],
          ["後"],
          ["前"],
          ["時"],
          ["；"],
          ["、"],
        ]
      : [
          ["and"],
          ["but"],
          ["or"],
          ["so"],
          ["because"],
          ["when"],
          ["while"],
          ["although"],
          ["if"],
          ["after"],
          ["before"],
          ["that"],
          ["which"],
          ["who"],
          ["where"],
          ["as"],
          ["as", "long", "as"],
          ["as", "soon", "as"],
          ["though"],
          ["nor"],
          ["yet"],
          ["as", "if"],
          ["by", "the", "time"],
          ["in", "case"],
          ["lest"],
          ["once"],
          ["so", "that"],
          ["until"],
          ["whenever"],
          ["wherever"],
          ["whereas"],
          [";"],
        ];
  const normalized = tokens.map((token) => token.text.toLowerCase());
  connectorPhrases
    .sort((left, right) => right.length - left.length)
    .forEach((phrase) => {
      for (let index = 0; index <= normalized.length - phrase.length; index += 1) {
        if (!phrase.every((word, offset) => normalized[index + offset] === word)) continue;
        phrase.forEach((_word, offset) => candidates.add(tokens[index + offset].id));
      }
    });
  return candidates;
}

function buildPanelsFromConnectors() {
  const game = state.game;
  if (game.reading) { game.manualPanelBoundaries = null; game.manualConnectorSegments = []; }
  const prompt = currentSentencePrompt();
  const tokens = sentenceTranslationTokens(sentenceTranslationTextForPanels(), prompt.sourceLanguage);
  const connectorGroups = selectedConnectorGroups(tokens, game.connectorSelection);
  const panels = [];
  const leadingConnectors = [];
  const applyLeadingConnectors = (panel) => {
    if (!leadingConnectors.length) return;
    panel.connectorBefore = leadingConnectors.join(" ");
    leadingConnectors.length = 0;
  };
  let start = 0;
  connectorGroups.forEach((group) => {
    const isBoundaryOnly = isCommaBoundaryConnector(group.text);
    if (group.start > start) {
      const panel = createSentencePanel(tokens.slice(start, group.start), panels.length);
      applyLeadingConnectors(panel);
      if (!isBoundaryOnly) panel.connectorAfter = group.text;
      panels.push(panel);
    } else if (panels.length && !isBoundaryOnly) {
      panels[panels.length - 1].connectorAfter = [panels[panels.length - 1].connectorAfter, group.text].filter(Boolean).join(" ");
    } else if (!isBoundaryOnly) {
      leadingConnectors.push(group.text);
    }
    start = group.end + 1;
  });
  if (start < tokens.length) {
    const panel = createSentencePanel(tokens.slice(start), panels.length);
    applyLeadingConnectors(panel);
    panels.push(panel);
  }
  if (!panels.length) panels.push(createSentencePanel(tokens, 0));
  game.panels = panels;
  game.status = "panels";
  renderSentenceTranslationActivity();
}

function selectedConnectorGroups(tokens, selection) {
  const ids = [...selection].sort((a, b) => a - b);
  const groups = [];
  let group = null;
  ids.forEach((id) => {
    if (!group || id !== group.end + 1) {
      group = { start: id, end: id };
      groups.push(group);
      return;
    }
    group.end = id;
  });
  return groups.map((item) => ({
    ...item,
    text: tokens
      .slice(item.start, item.end + 1)
      .map((token) => token.text)
      .join(" ")
      .replace(/\s+([,.;:!?，。！？；：])/g, "$1"),
  }));
}

function isCommaBoundaryConnector(text) {
  return text === "," || text === "，";
}

function frontedSubordinateCommaReminder(tokens, selection, language) {
  const connectorGroups = selectedConnectorGroups(tokens, selection);
  const subordinateConnectors = FRONTED_SUBORDINATE_CONNECTORS[language] || new Set();
  const frontedGroup = connectorGroups.find((group) => {
    if (group.start !== 0) return false;
    const normalized = language === "en" ? group.text.toLowerCase() : group.text;
    return subordinateConnectors.has(normalized);
  });
  if (!frontedGroup) return "";
  const commaToken = tokens.find((token) => token.id > frontedGroup.end && (token.text === "," || token.text === "，"));
  if (!commaToken || selection.has(commaToken.id)) return "";
  return `
    <div class="sentence-soft-reminder" role="note">
      This looks like a fronted setup. If the comma separates that setup from the main panel, select the comma too so both sides become separate panels.
    </div>
  `;
}

function createSentencePanel(tokens, index) {
  return {
    index,
    tokens: tokens.map((token, localIndex) => ({ ...token, localId: localIndex })),
    connectorBefore: "",
    connectorAfter: "",
    answers: { subject: [], subjectText: "", action: [], modifier: [] },
    done: false,
  };
}

function manualSentencePanels(tokens, boundaries) {
  const cuts = [...new Set(boundaries)].filter(id => Number.isInteger(id) && id > 0 && id < tokens.length).sort((a, b) => a - b);
  return [0, ...cuts].map((start, index) => createSentencePanel(tokens.slice(start, [...cuts, tokens.length][index]), index));
}

function renderReadingStructureEditor() {
  const game = state.game, tokens = sentenceTranslationTokens(sentenceTranslationTextForPanels(), 'en');
  const points = new Set(game.structureDraftBoundaries);
  const preview = manualSentencePanels(tokens, [...points]);
  const signature = panel => panel.tokens.map(token => token.id).join(',');
  const available = new Set(preview.map(signature));
  game.structureDraftConnectors = game.structureDraftConnectors.filter(key => available.has(key));
  const connecting = new Set(game.structureDraftConnectors);
  let panelNumber = 0;
  return `<div class="modal-backdrop sentence-modal-backdrop"><div class="modal sentence-panel-modal" role="dialog" aria-modal="true" aria-labelledby="reading-structure-title">
    <h3 id="reading-structure-title">Fix structure</h3><p>Click between words to add or remove a panel boundary. Every word stays in the sentence.</p>
    <div class="reading-structure-board">${tokens.map((token, index) => `${index ? `<button class="reading-structure-boundary ${points.has(index) ? 'active' : ''}" type="button" data-reading-structure-boundary="${index}" aria-pressed="${points.has(index)}" aria-label="Split between ${escapeHtml(tokens[index - 1].text)} and ${escapeHtml(token.text)}">${points.has(index) ? '│' : '+'}</button>` : ''}<span class="reading-structure-word" data-i18n-skip>${escapeHtml(token.text)}</span>`).join('')}</div>
    <h4>Panel preview</h4>${preview.map(panel => {
      const key = signature(panel), isConnector = connecting.has(key);
      return `<div class="reading-structure-preview ${isConnector ? 'connecting' : ''}"><strong>${isConnector ? 'Connecting word' : `Panel ${++panelNumber}`}</strong><p data-i18n-skip>${escapeHtml(sentencePanelText(panel))}</p>
        <button class="ghost-button" type="button" data-reading-structure-connector="${key}" aria-pressed="${isConnector}">${isConnector ? 'this is a panel' : 'this is connecting word'}</button></div>`;
    }).join('')}
    ${panelNumber ? '' : '<p role="status">Keep at least one segment as a panel.</p>'}
    <p class="helper-note">Changed panels need new role selections and chunk translations. Unchanged panels and your full-sentence draft are kept.</p>
    <div class="form-actions"><button type="button" class="ghost-button" data-reading-structure-cancel>Cancel</button><button type="button" class="primary-button" data-reading-structure-apply ${panelNumber ? '' : 'disabled'}>Apply structure</button></div>
  </div></div>`;
}

function applyReadingStructure() {
  const game = state.game, tokens = sentenceTranslationTokens(sentenceTranslationTextForPanels(), 'en');
  const signature = panel => panel.tokens.map(token => token.id).join(',');
  const originals = new Map(game.panels.map(panel => [signature(panel), panel]));
  const segments = manualSentencePanels(tokens, game.structureDraftBoundaries);
  const connecting = new Set(game.structureDraftConnectors), panels = [], leading = [];
  for (const segment of segments) {
    if (connecting.has(signature(segment))) {
      const text = sentencePanelText(segment);
      if (panels.length) panels[panels.length - 1].connectorAfter = [panels[panels.length - 1].connectorAfter, text].filter(Boolean).join(' ');
      else leading.push(text);
    } else {
      segment.index = panels.length;
      if (leading.length) { segment.connectorBefore = leading.join(' '); leading.length = 0; }
      panels.push(segment);
    }
  }
  if (!panels.length) return;
  const changed = panels.length !== game.panels.length || panels.some((panel, index) => signature(panel) !== signature(game.panels[index]) || panel.connectorBefore !== game.panels[index].connectorBefore || panel.connectorAfter !== game.panels[index].connectorAfter);
  game.panels = panels.map(panel => {
    const original = originals.get(signature(panel));
    return original ? {...structuredClone(original), index: panel.index, connectorBefore: panel.connectorBefore, connectorAfter: panel.connectorAfter} : panel;
  });
  if (changed) { game.chunkOrder = []; game.chunkPunctuation = {}; }
  game.manualPanelBoundaries = [...new Set(game.structureDraftBoundaries)].sort((a, b) => a - b);
  game.manualConnectorSegments = [...connecting];
  game.connectorSelection = new Set(); game.status = 'panels'; game.activePanelIndex = null;
  game.selectedTokenIds = new Set(); game.subjectFinderOpen = false; game.structureEditorOpen = false;
  renderSentenceTranslationActivity({localOnly: true});
}

function sentencePanelText(panel) {
  return (panel?.tokens || []).map((token) => token.text).join(" ").replace(/\s+([,.;:!?，。！？；：])/g, "$1");
}

function renderSentenceTranslationActivity({localOnly = false} = {}) {
  const game = state.game;
  if (!game || (game.mode !== "sentence-translation" && game.mode !== "chinese-english-translation")) return;
  const prompt = currentSentencePrompt();
  if (!prompt) return;
  if (game.reading && game.clauseTree) return ReadingClauses.render();
  $("#review-activity").innerHTML = `
    <section class="sentence-comic-activity">
      ${renderSentenceTranslationTop(prompt)}
      ${game.reading && typeof ReadingClauses !== 'undefined' ? '<button type="button" class="ghost-button" data-reading-clause-upgrade>Use clause structure workflow</button>' : ''}
      ${game.status === "method-choice" ? renderTranslationMethodChoice() : ""}
      ${game.status === "owner-edit" ? renderOwnerEditStep(prompt) : ""}
      ${game.status === "connectors" ? renderConnectorStep(prompt) : ""}
      ${game.status === "panels" || (!game.reading && game.status === "translate" && game.method !== "direct") ? renderPanelStep(prompt) : ""}
      ${game.reading && game.status === 'translate' && game.method !== 'direct' ? renderReadingChunkStep(true) : ''}
      ${game.activePanelIndex !== null ? renderPanelModal() : ""}
      ${game.subjectFinderOpen ? renderSubjectFinderModal(prompt) : ""}
      ${game.status === "translate" && !game.resultOpen ? renderTranslationModal(prompt) : ""}
      ${game.resultOpen ? renderTranslationResultModal(prompt) : ""}
      ${game.askTeacherHelpOpen ? renderAskTeacherHelpModal() : ""}
      ${game.connectorHelpOpen ? renderConnectorHelpModal() : ""}
      ${game.reading && game.structureEditorOpen ? renderReadingStructureEditor() : ''}
      ${game.reading?.repositionChunkId && !game.resultOpen ? renderReadingRepositionModal() : ''}
      ${game.reading && game.omittedConnectorEditorOpen ? renderReadingOmittedConnectorModal() : ''}
    </section>
  `;
  if (game.reading && !game.resultOpen) game.reading.onChange(readingSentenceState(), {autosave: !localOnly});
}

function renderTranslationMethodChoice() {
  return `
    <div class="panel sentence-comic-step">
      <div class="panel-header">
        <h3>Choose how to translate</h3>
        <p>Use the helper to build the sentence image first, or translate directly when that process is already internal.</p>
      </div>
      <div class="translation-method-grid">
        <button class="translation-method-card" type="button" data-translation-method="helper">
          <strong>Use helper</strong>
          <span>Split the sentence into panels, answer the image questions, then translate.</span>
        </button>
        <button class="translation-method-card" type="button" data-translation-method="direct">
          <strong>Translate directly</strong>
          <span>Go straight to the translation field.</span>
        </button>
      </div>
    </div>
  `;
}

function renderSentenceTranslationTop(prompt) {
  const game = state.game;
  if (game.reading) return `<div class="panel sentence-comic-header"><div>
    <p class="eyebrow">${escapeHtml(game.reading.title)} · Sentence ${game.reading.position} / ${game.reading.total}</p>
    <h2 data-i18n-skip>${escapeHtml(prompt.sourceText)}</h2>
    <p>Shared class answer · Subject / Predicate / Adverbial</p></div></div>`;
  return `
    <div class="panel sentence-comic-header">
      <div>
        <p class="eyebrow">${game.isChineseToEnglish ? "Writing skill" : "Reading skill"}</p>
        <h2 data-i18n-skip>${escapeHtml(prompt.sourceText)}</h2>
        <p class="helper-note"><span>${game.index + 1} / ${game.prompts.length}</span> · <span data-i18n-skip>${escapeHtml(reviewWord(prompt.entry))}</span> · <span>Set ${escapeHtml(prompt.set.set_number || "")}</span></p>
      </div>
    </div>
  `;
}

function renderOwnerEditStep(prompt) {
  return `
    <div class="panel sentence-comic-step">
      <div class="panel-header">
        <h3>Make every action show its owner</h3>
        <p>Edit the Chinese sentence before splitting it into panels.</p>
      </div>
      <label>
        Sentence
        <textarea class="sentence-owner-editor" data-owner-edit>${escapeHtml(prompt.ownerEditedText || prompt.sourceText)}</textarea>
      </label>
      <div class="form-actions">
        <button class="primary-button" type="button" data-owner-edit-done>Continue</button>
      </div>
    </div>
  `;
}

function renderConnectorStep(prompt) {
  const game = state.game;
  const text = sentenceTranslationTextForPanels();
  const tokens = sentenceTranslationTokens(text, prompt.sourceLanguage);
  const candidates = connectorCandidateIndexes(tokens, prompt.sourceLanguage);
  return `
    <div class="panel sentence-comic-step">
      <div class="panel-header">
        <div class="sentence-help-heading">
          <h3>1. Choose connecting devices</h3>
          <button class="icon-button sentence-help-button" type="button" data-connector-help aria-label="Connecting device help" title="Connecting device help">?</button>
        </div>
        <p>Possible connecting devices are highlighted for you. Confirm the ones that actually connect panels in this sentence.</p>
      </div>
      <div class="sentence-token-board">
        ${tokens
          .map(
            (token) => `
              <button class="sentence-token ${game.connectorSelection.has(token.id) ? "selected" : ""} ${candidates.has(token.id) ? "suggested" : ""}" type="button" data-connector-token="${token.id}" data-i18n-skip>
                ${escapeHtml(token.text)}
              </button>
            `,
          )
          .join("")}
      </div>
      ${frontedSubordinateCommaReminder(tokens, game.connectorSelection, prompt.sourceLanguage)}
      <div class="form-actions">
        ${game.isChineseToEnglish || game.reading ? '<button class="ghost-button" type="button" data-translation-back>Back</button>' : ""}
        <button class="primary-button" type="button" data-build-panels>${game.reading ? 'Divide into panels' : 'Generate panels'}</button>
        ${game.reading ? '<button class="ghost-button" type="button" data-reading-fix-structure>Fix structure</button><button class="ghost-button" type="button" data-reading-add-omitted>add omitted connecting word</button>' : ''}
      </div>
    </div>
  `;
}

function renderConnectorHelpModal() {
  return `
    <div class="modal-backdrop sentence-modal-backdrop">
      <div class="modal sentence-help-modal" role="dialog" aria-modal="true" aria-labelledby="connector-help-title">
        <div class="modal-header">
          <div>
            <p class="eyebrow">Reading judgment</p>
            <h3 id="connector-help-title">Highlighted words are only possibilities.</h3>
          </div>
          <button class="icon-button" type="button" data-close-connector-help aria-label="Close">x</button>
        </div>
        <div class="sentence-help-body">
          <p>Real reading is a fast scan, so possible connectors can be noticed before you know whether they truly connect two panels. Your job is to confirm the correct usage.</p>
          <div class="content-definition">
            <strong>False detection examples</strong>
            <p><span data-i18n-skip>Who called?</span> The word <span data-i18n-skip>Who</span> asks a question; it does not connect two panels.</p>
            <p><span data-i18n-skip>I like that idea.</span> The word <span data-i18n-skip>that</span> points to an idea; it is not connecting a new panel.</p>
            <p><span data-i18n-skip>The person who called left early.</span> The word <span data-i18n-skip>who</span> introduces extra description inside one image, so decide whether you want a separate panel.</p>
          </div>
        </div>
        <div class="form-actions">
          <button class="primary-button" type="button" data-close-connector-help>Got it</button>
        </div>
      </div>
    </div>
  `;
}

function renderPanelStep() {
  const game = state.game;
  const allDone = allSentencePanelsComplete();
  return `
    <div class="panel sentence-comic-step">
      <div class="panel-header">
        <h3>${game.reading ? '2. Select and translate chunks' : '2. Fill the comic panels'}</h3>
        <p>${game.reading ? 'Edit each panel’s selections and translate its chunks in the table. Done saves the panel.' : 'Open each panel and answer the three questions with words from that panel.'}</p>
      </div>
      <div class="sentence-panel-grid">
        ${renderSentencePanelSequence(game.panels)}
      </div>
      <div class="form-actions">
        <button class="ghost-button" type="button" data-translation-back>Back</button>
        ${game.reading ? '<button class="ghost-button" type="button" data-reading-fix-structure>Fix structure</button><button class="ghost-button" type="button" data-reading-add-omitted>add omitted connecting word</button>' : ''}
        ${allDone ? `<button class="primary-button" type="button" data-start-sentence-translation>${game.reading ? 'Start full-sentence translation' : 'Start translation'}</button>` : ""}
      </div>
    </div>
  `;
}

function renderSentencePanelSequence(panels) {
  return panels
    .map((panel, index) => {
      const connectorBefore = panel.connectorBefore ? (state.game.reading ? renderReadingConnectorChunk(panel, 'connectorBefore') : renderSentenceConnectorBetweenPanels(panel.connectorBefore)) : "";
      const connector = panel.connectorAfter && (state.game.reading || index < panels.length - 1) ? (state.game.reading ? renderReadingConnectorChunk(panel, 'connectorAfter') : renderSentenceConnectorBetweenPanels(panel.connectorAfter)) : "";
      return `${state.game.reading ? renderReadingOmittedAtGap(index) : ''}${connectorBefore}${renderSentencePanelCard(panel)}${connector}${state.game.reading && index === panels.length - 1 ? renderReadingOmittedAtGap(panels.length) : ''}`;
    })
    .join("");
}

function readingPanelChunks(panel) {
  const roles = ['subject', 'action', 'modifier'].flatMap(role => {
    const selections = panel.answers[role] || [];
    const groups = Array.isArray(selections[0]) ? selections : selections.length ? [selections] : [];
    return selectedPanelTexts(panel, role).map((text, index) => ({role, text,
      label: {subject: 'Subject', action: 'Predicate', modifier: 'Adverbial'}[role],
      // Token-based keys keep translations attached when other chunks are removed.
      key: role === 'subject' && panel.answers.subjectText ? `subject:shared:${text}` :
        `${role}:${(groups[index] || []).map(id => panel.tokens[id]?.id).join(',')}`,
    }));
  });
  return [...(panel.connectorBefore ? [readingConnectorChunk(panel, 'connectorBefore')] : []), ...roles,
    ...(panel.connectorAfter ? [readingConnectorChunk(panel, 'connectorAfter')] : [])];
}

function readingConnectorChunk(panel, side) {
  return {role: 'connector', text: panel[side], label: 'Connecting word', key: `${side}:${panel[side]}`};
}

function readingConnectorParts(panel, chunk) {
  const id = chunk.id || `${panel.index}|${chunk.key}`;
  return [chunk, ...(state.game.connectorExtraTranslations[id] || []).map((text, index) => ({
    ...chunk, id: `${id}|extra:${index}`, extraBase: id, extraIndex: index, translation: text,
  }))];
}

function renderReadingConnectorRows(panel, chunk, summary) {
  const id = chunk.id || `${panel.index}|${chunk.key}`;
  return readingConnectorParts(panel, chunk).map(part => renderReadingChunkRow(panel, part, summary)).join('') +
    (summary ? '' : `<tr class="connector"><td colspan="2"><button type="button" class="ghost-button" data-reading-add-connector-translation="${escapeHtml(id)}" aria-label="Add translation chunk for ${escapeHtml(chunk.text)}">+</button></td></tr>`);
}

function renderReadingChunkRow(panel, chunk, summary = false) {
  return `<tr class="${chunk.role}"><th scope="row"><span class="reading-chunk-role">${chunk.label}</span><span data-i18n-skip>${escapeHtml(chunk.text)}</span></th>
    <td>${summary ? renderReadingOrderButton(panel, chunk) :
      `<textarea rows="2" ${chunk.extraBase ? `data-reading-extra-base="${escapeHtml(chunk.extraBase)}" data-reading-extra-index="${chunk.extraIndex}"` : chunk.omittedId ? `data-reading-omitted-translation="${escapeHtml(chunk.omittedId)}"` : `data-reading-chunk-panel="${panel.index}" data-reading-chunk-key="${escapeHtml(chunk.key)}"`} aria-label="${chunk.label}: ${escapeHtml(chunk.text)} — Chinese translation" placeholder="中文翻譯…">${escapeHtml(chunk.translation ?? panel.chunkTranslations?.[chunk.key] ?? '')}</textarea>`}</td></tr>`;
}

function renderReadingConnectorChunk(panel, side, summary = false) {
  return `<section class="reading-connector-chunk" aria-label="Connecting word">
    <table class="reading-chunk-table"><tbody>${renderReadingConnectorRows(panel, readingConnectorChunk(panel, side), summary)}</tbody></table></section>`;
}

function renderReadingChunkTable(panel, summary = false) {
  return `<table class="reading-chunk-table"><thead><tr><th scope="col">English chunk</th><th scope="col">Chinese translation</th></tr></thead><tbody>
      ${readingPanelChunks(panel).filter(chunk => chunk.role !== 'connector').map(chunk => renderReadingChunkRow(panel, chunk, summary)).join('')}
      </tbody></table>
      ${readingPanelChunks(panel).length ? '' : '<p>Edit selections to add Subject, Predicate, and Adverbial chunks.</p>'}`;
}

function readingTranslatedChunks() {
  return [...state.game.panels.flatMap(panel => readingPanelChunks(panel).flatMap(chunk =>
    (chunk.role === 'connector' ? readingConnectorParts(panel, chunk) : [chunk]).map(part => ({
      id: part.id || `${panel.index}|${part.key}`, text: part.translation ?? panel.chunkTranslations?.[part.key] ?? '',
    })))), ...state.game.omittedConnectors.flatMap(entry =>
      readingConnectorParts({}, {id: `omitted:${entry.id}`, translation: entry.translation}).map(part => ({id: part.id, text: part.translation})))];
}

function readingOmittedGap(entry) {
  const index = state.game.panels.findIndex(panel => panel.tokens[0].id >= entry.anchor);
  return index < 0 ? state.game.panels.length : index;
}

function renderReadingOmittedAtGap(index, summary = false) {
  return state.game.omittedConnectors.filter(entry => readingOmittedGap(entry) === index).map(entry => {
    const chunk = {id: `omitted:${entry.id}`, key: `omitted:${entry.id}`, omittedId: entry.id, role: 'connector', label: 'Omitted connecting word', text: entry.english, translation: entry.translation};
    return `<section class="reading-connector-chunk" data-reading-omitted-container="${escapeHtml(entry.id)}" aria-label="Omitted connecting word"><table class="reading-chunk-table"><tbody>${renderReadingConnectorRows({index, chunkTranslations: {}}, chunk, summary)}</tbody></table>
      ${summary ? '' : `<button type="button" class="ghost-button" data-reading-remove-omitted="${escapeHtml(entry.id)}">Remove</button>`}</section>`;
  }).join('');
}

function renderReadingOmittedConnectorModal() {
  const game = state.game;
  const gap = index => `<button type="button" class="reading-reposition-gap ${game.omittedConnectorDraftPosition === index ? 'active' : ''}" data-reading-omitted-gap="${index}" aria-pressed="${game.omittedConnectorDraftPosition === index}" aria-label="Insert connecting word at position ${index + 1}">+</button>`;
  return `<div class="modal-backdrop sentence-modal-backdrop"><div class="modal sentence-panel-modal" role="dialog" aria-modal="true" aria-labelledby="reading-omitted-title">
    <h3 id="reading-omitted-title">Add omitted connecting word</h3><p>Choose a + gap between panels, then enter the connecting word. The original sentence stays intact.</p>
    <div class="reading-order-sequence reading-omitted-positions">${game.panels.map((panel, index) => `${gap(index)}<span class="reading-reposition-item reading-omitted-panel"><strong>Panel ${index + 1}</strong><span data-i18n-skip>${escapeHtml(sentencePanelText(panel))}</span></span>`).join('')}${gap(game.panels.length)}</div>
    <label>Connecting word<input type="text" maxlength="100" data-reading-omitted-word value="${escapeHtml(game.omittedConnectorDraftText)}"></label>
    <div class="form-actions"><button type="button" class="ghost-button" data-reading-omitted-cancel>Cancel</button><button type="button" class="primary-button" data-reading-omitted-apply ${game.omittedConnectorDraftPosition === null || !game.omittedConnectorDraftText.trim() ? 'disabled' : ''}>Insert connecting word</button></div>
  </div></div>`;
}

function renderReadingOrderButton(panel, chunk) {
  const id = chunk.id || `${panel.index}|${chunk.key}`, order = state.game.chunkOrder || [];
  const number = order.indexOf(id) + 1, text = chunk.translation ?? panel.chunkTranslations?.[chunk.key] ?? '';
  return `<div class="reading-order-container"><button class="reading-order-chunk ${number ? 'selected' : ''}" type="button"
    data-reading-order-chunk="${escapeHtml(id)}" aria-pressed="${!!number}" ${text.trim() ? '' : 'disabled'}
    aria-label="Panel ${panel.index + 1} ${chunk.label}: ${escapeHtml(text || 'No Chinese translation')} ${number ? `— order ${number}` : ''}">
    <span class="reading-order-number" aria-hidden="true">${number || '+'}</span>
    <span class="reading-answer" data-i18n-skip>${escapeHtml(text || 'Add a translation in Step 2')}${escapeHtml(state.game.chunkPunctuation[id] || '')}</span></button>
    <div class="reading-chunk-controls">${['，','。'].map(mark => `<button type="button" class="ghost-button ${state.game.chunkPunctuation?.[id]?.includes(mark) ? 'selected' : ''}" data-reading-chunk-punctuation="${escapeHtml(id)}" data-reading-punctuation-mark="${mark}"
      aria-pressed="${!!state.game.chunkPunctuation?.[id]?.includes(mark)}" aria-label="${mark === '，' ? 'Chinese comma' : 'Chinese period'} after ${escapeHtml(text)}" ${text.trim() ? '' : 'disabled'}>${mark}</button>`).join('')}
    <button type="button" class="ghost-button" data-reading-reposition="${escapeHtml(id)}" ${number ? '' : 'disabled'}>Reposition</button></div></div>`;
}

function updateReadingOrderedTranslation() {
  const chunks = new Map(readingTranslatedChunks().map(chunk => [chunk.id, chunk.text]));
  state.game.chunkOrder = state.game.chunkOrder.filter(id => chunks.has(id) && chunks.get(id).trim());
  state.game.translationDraft = state.game.chunkOrder.map(id => chunks.get(id).trim() + (state.game.chunkPunctuation[id] || '')).join('');
  renderSentenceTranslationActivity({localOnly: true});
}

function readingOrderPunctuation(id) {
  return /^punctuation:[a-f0-9-]+:([，。])$/.exec(id)?.[1] || '';
}

function normalizeReadingPunctuation() {
  const game = state.game, order = []; let previous = null;
  game.chunkPunctuation ||= {};
  // Old saved standalone marks become suffixes; preserve the full edited draft.
  for (const id of game.chunkOrder || []) {
    const mark = readingOrderPunctuation(id);
    if (mark) { if (previous) game.chunkPunctuation[previous] = (game.chunkPunctuation[previous] || '') + mark; }
    else { order.push(id); previous = id; }
  }
  game.chunkOrder = order;
}

function renderReadingRepositionModal() {
  const game = state.game, moving = game.reading.repositionChunkId;
  const chunks = new Map(readingTranslatedChunks().map(chunk => [chunk.id, chunk.text]));
  const remaining = game.chunkOrder.filter(id => id !== moving);
  const gap = index => `<button type="button" class="reading-reposition-gap" data-reading-reposition-gap="${index}" aria-label="Move chunk to position ${index + 1}">+</button>`;
  return `<div class="modal-backdrop sentence-modal-backdrop"><div class="modal sentence-panel-modal" role="dialog" aria-modal="true" aria-labelledby="reading-reposition-title">
    <h3 id="reading-reposition-title">Reposition chunk</h3><p>Moving: <strong>${escapeHtml(chunks.get(moving) || '')}${escapeHtml(game.chunkPunctuation[moving] || '')}</strong></p>
    <p>Choose a + gap to place this chunk. Its punctuation moves with it.</p>
    <div class="reading-order-sequence" role="group" aria-label="Choose chunk position">${remaining.map((id, index) => `${gap(index)}<span class="reading-reposition-item"><span class="reading-order-number">${index + 1}</span> ${escapeHtml(chunks.get(id) || '')}${escapeHtml(game.chunkPunctuation[id] || '')}</span>`).join('')}${gap(remaining.length)}</div>
    <button type="button" class="ghost-button" data-reading-reposition-cancel>Cancel</button></div></div>`;
}

function renderReadingChunkStep(summary = true) {
  const available = new Set(readingTranslatedChunks().filter(chunk => chunk.text.trim()).map(chunk => chunk.id));
  state.game.chunkOrder = (state.game.chunkOrder || []).filter(id => available.has(id));
  return `<div class="panel sentence-comic-step reading-chunk-step"><h3>Choose the Chinese chunk order</h3>
    <p>Click the translated chunks in the order you want them to appear. Click a numbered chunk again to remove it. Changing the order rebuilds the sentence below; you can edit it afterward.</p>
    <button class="ghost-button" type="button" data-reading-clear-order>Clear order</button>
    ${state.game.panels.map((panel, index) => `${renderReadingOmittedAtGap(index, summary)}${panel.connectorBefore ? renderReadingConnectorChunk(panel, 'connectorBefore', summary) : ''}<section class="reading-chunk-panel">
      <h4>Panel ${panel.index + 1}</h4>
      ${renderReadingChunkTable(panel, summary)}
    </section>${panel.connectorAfter ? renderReadingConnectorChunk(panel, 'connectorAfter', summary) : ''}${index === state.game.panels.length - 1 ? renderReadingOmittedAtGap(state.game.panels.length, summary) : ''}`).join('')}
  </div>`;
}

function renderSentenceConnectorBetweenPanels(text) {
  return `<div class="sentence-panel-connector" data-i18n-skip>${escapeHtml(text)}</div>`;
}

function renderSentencePanelCard(panel) {
  if (state.game.reading && panel.done) return `<section class="reading-chunk-panel reading-selection-result" data-reading-result-panel="${panel.index}">
    <div class="reading-panel-header"><h4>Panel ${panel.index + 1}</h4>
    <button class="ghost-button" type="button" data-open-panel="${panel.index}">Edit selections</button></div>
    ${renderReadingChunkTable(panel)}
    <button class="primary-button" type="button" data-reading-panel-save="${panel.index}">Done</button>
  </section>`;
  return `
    <button class="sentence-panel-card ${panel.done ? "done" : ""}" type="button" data-open-panel="${panel.index}">
      <span class="sentence-panel-number">Panel ${panel.index + 1}</span>
      ${
        panel.done
          ? `<span class="sentence-panel-chunks" data-i18n-skip>${renderRoleChunkRow(panel)}</span>`
          : `<span class="sentence-panel-text" data-i18n-skip>${escapeHtml(sentencePanelText(panel)) || "Empty panel"}</span>`
      }
    </button>
  `;
}

function renderRoleChunkRow(panel) {
  const chunks = ["subject", "action", "modifier"]
    .flatMap((role) => selectedPanelTexts(panel, role).map(text => `<span class="sentence-role-chunk ${role}">${escapeHtml(text)}</span>`))
    .join("");
  return chunks || `<span class="sentence-panel-text">${escapeHtml(sentencePanelText(panel)) || "Empty panel"}</span>`;
}

function renderPanelModal() {
  const game = state.game;
  const panel = game.panels[game.activePanelIndex];
  if (!panel) return "";
  return `
    <div class="modal-backdrop sentence-modal-backdrop">
      <div class="modal sentence-panel-modal" role="dialog" aria-modal="true" aria-labelledby="sentence-panel-modal-title">
        <div class="modal-header">
          <div>
            <p class="eyebrow">Panel ${panel.index + 1}</p>
            <h3 id="sentence-panel-modal-title" data-i18n-skip>${escapeHtml(sentencePanelText(panel))}</h3>
          </div>
          <button class="icon-button" type="button" data-close-panel aria-label="Close">x</button>
        </div>
        <div class="sentence-token-board panel-token-board">
          ${panel.tokens
            .map(
              (token) => `
                <button class="sentence-token panel-sentence-token ${game.selectedTokenIds.has(token.localId) ? "pending-selected" : ""}" type="button" data-panel-token="${token.localId}" data-i18n-skip>
                  ${escapeHtml(token.text)}
                </button>
              `,
            )
            .join("")}
        </div>
        <div class="sentence-question-list">
          ${["subject", "action", "modifier"].map((role) => renderSentenceQuestion(panel, role)).join("")}
        </div>
      <div class="form-actions">
          <button class="ghost-button" type="button" data-close-panel>Close</button>
          <button class="primary-button" type="button" data-finish-panel>Done</button>
        </div>
      </div>
    </div>
  `;
}

function renderSentenceQuestion(panel, role) {
  const answer = selectedPanelText(panel, role);
  const phraseAnswers = role === "modifier" || (role === "action" && state.game.reading) ? selectedPanelTexts(panel, role) : [];
  return `
    <section class="sentence-question ${state.game.activeQuestion === role ? "active" : ""}">
      <div class="sentence-question-head">
        <strong>${state.game.reading ? `${{subject: 'Subject', action: 'Predicate', modifier: 'Adverbial'}[role]} — ` : ''}${escapeHtml(SENTENCE_TRANSLATION_LABELS[role])}</strong>
        <span class="sentence-question-actions">
          <button class="primary-button" type="button" data-use-selection="${role}">Use selected words</button>
          ${role === "subject" ? '<button class="ghost-button" type="button" data-open-subject-finder>Not found</button>' : ""}
        </span>
      </div>
      <div class="sentence-answer-row ${answer ? role : ""}" data-i18n-skip>
        ${
          phraseAnswers.length
            ? phraseAnswers.map((text, index) => renderSentencePhraseChip(text, index, role)).join("")
            : answer
              ? escapeHtml(answer)
              : '<span class="muted-text">No words selected yet.</span>'
        }
      </div>
    </section>
  `;
}

function renderModifierAnswerChip(text, index) {
  return renderSentencePhraseChip(text, index, 'modifier');
}

function renderSentencePhraseChip(text, index, role) {
  const label = role === 'action' ? 'predicate' : 'modifier';
  return `
    <span class="sentence-phrase-answer ${role === 'action' ? 'sentence-predicate-answer' : 'sentence-modifier-answer'}">
      <span>${escapeHtml(text)}</span>
      <button type="button" data-remove-${role}-answer="${index}" aria-label="Remove ${label} chunk" title="Remove ${label} chunk">x</button>
    </span>
  `;
}

function selectedPanelText(panel, role) {
  if (role === "subject" && panel?.answers?.subjectText) return panel.answers.subjectText;
  if (role === "modifier" || (role === "action" && Array.isArray(panel?.answers?.action?.[0]))) return selectedPanelTexts(panel, role).join(" / ");
  const ids = new Set(panel?.answers?.[role] || []);
  return (panel?.tokens || [])
    .filter((token) => ids.has(token.localId))
    .map((token) => token.text)
    .join(" ")
    .replace(/\s+([,.;:!?，。！？；：])/g, "$1");
}

function selectedPanelTexts(panel, role) {
  if (role !== "modifier" && !(role === "action" && Array.isArray(panel?.answers?.action?.[0]))) return [selectedPanelText(panel, role)].filter(Boolean);
  const groups = Array.isArray(panel?.answers?.[role]?.[0]) ? panel.answers[role] : panel?.answers?.[role]?.length ? [panel.answers[role]] : [];
  return groups
    .map((ids) => {
      const idSet = new Set(ids || []);
      return (panel?.tokens || [])
        .filter((token) => idSet.has(token.localId))
        .map((token) => token.text)
        .join(" ")
        .replace(/\s+([,.;:!?，。！？；：])/g, "$1");
    })
    .filter(Boolean);
}

function renderTranslationModal(prompt) {
  if (state.game.translationCollapsed) {
    return `
      <div class="sentence-translation-float collapsed">
        <button class="primary-button sentence-translation-expand" type="button" data-toggle-translation-float aria-label="Open translation input" title="Open translation input">T</button>
      </div>
    `;
  }
  return `
    <div class="sentence-translation-float ${state.game.reading ? 'reading-translation-inline' : ''}">
      <div class="modal sentence-translation-modal" role="${state.game.reading ? 'group' : 'dialog'}" aria-labelledby="sentence-translation-title">
        <div class="sentence-translation-float-header">
          <div>
            <p class="eyebrow">${state.game.reading ? '3. Full-sentence translation' : '3. Translation'}</p>
            <h3 id="sentence-translation-title" data-i18n-skip>${escapeHtml(prompt.sourceText)}</h3>
          </div>
          <button class="icon-button" type="button" data-toggle-translation-float aria-label="Collapse translation input" title="Collapse translation input">-</button>
        </div>
        <textarea class="sentence-translation-input" data-translation-draft placeholder="${state.game.isChineseToEnglish ? "Write the English translation here..." : "寫下自然的中文翻譯..."}">${escapeHtml(state.game.translationDraft)}</textarea>
        <div class="form-actions">
          <button class="ghost-button" type="button" data-translation-back>Back</button>
          <button class="primary-button" type="button" data-finish-sentence-translation ${state.game.translationDraft.trim() ? "" : "disabled"}>Finish</button>
        </div>
      </div>
    </div>
  `;
}

function renderTranslationResultModal(prompt) {
  if (state.game.reading) {
    const reading = state.game.reading;
    return `<div class="modal-backdrop sentence-modal-backdrop"><div class="modal sentence-result-modal" role="dialog" aria-modal="true" aria-labelledby="sentence-result-title">
      <h3 id="sentence-result-title">Saved class answer</h3><p class="reading-answer">${escapeHtml(state.game.translationDraft)}</p>
      ${prompt.targetText ? `<section><strong>Natural translation</strong><p>${escapeHtml(prompt.targetText)}</p></section>` : ''}
      ${prompt.semanticChunks.length ? `<section><strong>Translation chunks</strong>${renderTranslationChunks(prompt)}</section>` : ''}
      <p>${reading.completedCount()} / ${reading.total} sentences completed</p><div class="form-actions">
      ${reading.position < reading.total ? '<button type="button" class="primary-button" data-reading-next>Next sentence</button>' : ''}
      <button type="button" class="ghost-button" data-reading-back>Back to passage</button></div></div></div>`;
  }
  return `
    <div class="modal-backdrop sentence-modal-backdrop">
      <div class="modal sentence-result-modal" role="dialog" aria-modal="true" aria-labelledby="sentence-result-title">
        <div>
          <p class="eyebrow">Result</p>
          <h3 id="sentence-result-title">Compare the full sentence and chunks</h3>
        </div>
        <section class="sentence-result-section">
          <strong>Your answer</strong>
          <p data-i18n-skip>${escapeHtml(state.game.translationDraft)}</p>
        </section>
        <section class="sentence-result-section">
          <strong>Natural translation</strong>
          <p data-i18n-skip>${escapeHtml(prompt.targetText)}</p>
        </section>
        <section class="sentence-result-section">
          <strong>Translation chunks</strong>
          <div class="sentence-result-chunks">${renderTranslationChunks(prompt)}</div>
        </section>
        <div class="form-actions">
          <button class="ghost-button" type="button" data-translation-back>Back</button>
          ${
            state.game.index < state.game.prompts.length - 1
              ? '<button class="primary-button" type="button" data-next-sentence-prompt>Next sentence</button>'
              : '<button class="primary-button" type="button" data-next-sentence-set>Do another set</button>'
          }
          ${state.game.index >= state.game.prompts.length - 1 && !state.game.isChineseToEnglish ? '<a class="ghost-button activity-back-link" href="/#review">Back to Review</a>' : ""}
          <button class="ghost-button" type="button" data-ask-teacher ${state.game.askTeacherSaved ? "disabled" : ""}>
            Ask teacher <span class="button-help-icon" data-ask-teacher-help aria-label="Ask Teacher help" title="Ask Teacher help">?</span>
          </button>
          <button class="ghost-button" type="button" data-retry-sentence-prompt>Try this sentence again</button>
        </div>
      </div>
    </div>
  `;
}

function renderAskTeacherHelpModal() {
  return `
    <div class="modal-backdrop sentence-modal-backdrop">
      <div class="modal sentence-help-modal" role="dialog" aria-modal="true" aria-labelledby="ask-teacher-help-title">
        <div class="modal-header">
          <div>
            <p class="eyebrow">Ask Teacher</p>
            <h3 id="ask-teacher-help-title">Save this sentence for teacher review.</h3>
          </div>
          <button class="icon-button" type="button" data-close-ask-teacher-help aria-label="Close">x</button>
        </div>
        <div class="sentence-help-body">
          <p>This records your answer, the natural translation, the Chinese translation, and the practice date.</p>
          <p>You can find saved questions in the Ask Teacher tab on the Review page and print them to PDF.</p>
        </div>
        <div class="form-actions">
          <button class="primary-button" type="button" data-close-ask-teacher-help>Got it</button>
        </div>
      </div>
    </div>
  `;
}

function renderTranslationChunks(prompt) {
  const sourceKey = prompt.sourceLanguage === "en" ? "english" : "traditional_chinese";
  const targetKey = prompt.targetLanguage === "en" ? "english" : "traditional_chinese";
  const chunks = prompt.semanticChunks.length
    ? prompt.semanticChunks.map((chunk) => ({ source: chunk[sourceKey] || "", target: chunk[targetKey] || "" }))
    : state.game.panels.map((panel) => ({ source: sentencePanelText(panel), target: renderRoleChunkRowPlain(panel) }));
  return chunks
    .filter((chunk) => chunk.source || chunk.target)
    .map(
      (chunk, index) => `
        <div class="sentence-result-chunk ${["subject", "action", "modifier"][index % 3]}" data-i18n-skip>
          <span>${escapeHtml(chunk.source)}</span>
          <strong>${escapeHtml(chunk.target)}</strong>
        </div>
      `,
    )
    .join("");
}

function renderRoleChunkRowPlain(panel) {
  return ["subject", "action"].map((role) => selectedPanelText(panel, role)).concat(selectedPanelTexts(panel, "modifier")).filter(Boolean).join(" / ");
}

function isSentencePanelComplete(panel) {
  return Boolean(panel?.done);
}

function allSentencePanelsComplete() {
  const game = state.game;
  return game?.panels?.length > 0 && game.panels.every(isSentencePanelComplete);
}

function openSentencePanel(index) {
  const game = state.game;
  const panel = game.panels[index];
  if (!panel) return;
  game.activePanelIndex = index;
  game.activeQuestion = "subject";
  game.selectedTokenIds = new Set();
  renderSentenceTranslationActivity();
}

function assignSentenceSelection(role) {
  const game = state.game;
  const panel = game.panels[game.activePanelIndex];
  if (!panel) return;
  const selectedIds = panel.tokens.map((token) => token.localId).filter((id) => game.selectedTokenIds.has(id));
  if (role === "modifier" || (role === "action" && game.reading)) {
    if (selectedIds.length) {
      const existing = Array.isArray(panel.answers[role]?.[0]) ? panel.answers[role] : panel.answers[role]?.length ? [panel.answers[role]] : [];
      panel.answers[role] = [...existing, selectedIds];
    }
  } else {
    panel.answers[role] = selectedIds;
    if (role === "subject") {
      panel.answers.subjectText = "";
      if (game.reading) panel.answers.sharedSubjectTokenIds = [];
    }
  }
  game.selectedTokenIds = new Set();
  game.activeQuestion = role === "subject" ? "action" : role === "action" ? "modifier" : "modifier";
  renderSentenceTranslationActivity();
}

function renderSubjectFinderModal(prompt) {
  const game = state.game;
  const tokens = sentenceTranslationTokens(sentenceTranslationTextForPanels(), prompt.sourceLanguage);
  return `
    <div class="modal-backdrop sentence-modal-backdrop">
      <div class="modal sentence-subject-finder-modal" role="dialog" aria-modal="true" aria-labelledby="subject-finder-title">
        <div class="modal-header">
          <div>
            <p class="eyebrow">Omitted subject</p>
            <h3 id="subject-finder-title">Select the missing subject from the full sentence.</h3>
            <p>Sometimes a panel does not repeat its subject because the reader can recover it from the larger sentence. Choose the owner of this panel's action from the full parsed sentence.</p>
          </div>
          <button class="icon-button" type="button" data-close-subject-finder aria-label="Close">x</button>
        </div>
        <div class="sentence-token-board panel-token-board">
          ${tokens
            .map(
              (token) => `
                <button class="sentence-token panel-sentence-token ${game.subjectFinderTokenIds.has(token.id) ? "pending-selected" : ""}" type="button" data-subject-finder-token="${token.id}" data-i18n-skip>
                  ${escapeHtml(token.text)}
                </button>
              `,
            )
            .join("")}
        </div>
        <div class="form-actions">
          <button class="ghost-button" type="button" data-close-subject-finder>Cancel</button>
          <button class="primary-button" type="button" data-apply-subject-finder>Use selected subject</button>
        </div>
      </div>
    </div>
  `;
}

function subjectFinderSelectionText() {
  const prompt = currentSentencePrompt();
  const tokens = sentenceTranslationTokens(sentenceTranslationTextForPanels(), prompt?.sourceLanguage || "en");
  const ids = new Set(state.game?.subjectFinderTokenIds || []);
  return tokens
    .filter((token) => ids.has(token.id))
    .map((token) => token.text)
    .join(" ")
    .replace(/\s+([,.;:!?，。！？；：])/g, "$1");
}

function applySubjectFinderSelection() {
  const game = state.game;
  const panel = game.panels[game.activePanelIndex];
  if (!panel) return;
  panel.answers.subject = [];
  panel.answers.subjectText = subjectFinderSelectionText();
  if (game.reading) panel.answers.sharedSubjectTokenIds = [...game.subjectFinderTokenIds];
  game.subjectFinderOpen = false;
  game.subjectFinderTokenIds = new Set();
  game.activeQuestion = "action";
  renderSentenceTranslationActivity();
}

function goBackSentenceTranslationStep() {
  const game = state.game;
  if (!game) return;
  if (game.resultOpen) {
    game.resultOpen = false;
    renderSentenceTranslationActivity();
    requestAnimationFrame(() => $("[data-translation-draft]")?.focus());
    return;
  }
  game.translationCollapsed = false;
  if (game.status === "translate") {
    game.status = game.method === "direct" ? "method-choice" : "panels";
  } else if (game.status === "panels") {
    game.status = "connectors";
    game.panels = [];
  } else if (game.status === "connectors" && game.isChineseToEnglish) {
    game.status = "owner-edit";
  } else if (game.status === "connectors" || game.status === "owner-edit") {
    game.status = "method-choice";
  }
  renderSentenceTranslationActivity();
}

function backToSentenceTranslationMethodChoice() {
  const game = state.game;
  if (!game || (game.mode !== "sentence-translation" && game.mode !== "chinese-english-translation")) return;
  game.status = "method-choice";
  game.method = "";
  game.resultOpen = false;
  game.askTeacherHelpOpen = false;
  game.connectorHelpOpen = false;
  game.activePanelIndex = null;
  game.subjectFinderOpen = false;
  game.translationCollapsed = false;
  renderSentenceTranslationActivity();
}

function finishSentencePanel() {
  const game = state.game;
  const panel = game.panels[game.activePanelIndex];
  if (!panel) return;
  panel.done = true;
  game.activePanelIndex = null;
  game.selectedTokenIds = new Set();
  renderSentenceTranslationActivity();
}

async function recordSentenceTranslationCompletion() {
  const game = state.game;
  if (!game || game.completionRecorded) return;
  game.clientAttemptId ||= crypto.randomUUID();
  const completedAt = new Date().toISOString();
  const reviewOffset = sentenceTranslationReviewOffset();
  const sessionIds = [...new Set(game.prompts.map((prompt) => String(prompt.entry.sessionId)))];
  await Promise.all(
    sessionIds.map((sessionId) => {
      const completedSetNumber = Number(game.sessionSetNumbers?.get(sessionId) || 1);
      return api("/api/review-activity-attempts", {
        method: "POST",
        body: JSON.stringify({
          session_id: sessionId,
          activity_type: game.mode,
          client_attempt_id: game.clientAttemptId,
          review_offset: reviewOffset,
          set_number: completedSetNumber,
          is_required_review: completedSetNumber === 1,
          completed_at: completedAt,
          result: {
            set_number: completedSetNumber,
            prompt_count: game.prompts.filter((prompt) => String(prompt.entry.sessionId) === sessionId).length,
          },
        }),
      });
    }),
  );
  game.completionRecorded = true;
}

function currentSentenceChineseTranslation(prompt) {
  return prompt.targetLanguage === "zh" ? prompt.targetText : prompt.sourceText;
}

async function recordAskTeacherRequest() {
  const game = state.game;
  const prompt = currentSentencePrompt();
  if (!game || !prompt || game.askTeacherSaved) return;
  const practiceDate = new Date().toISOString();
  const setNumber = Number(prompt.set?.set_number || game.sessionSetNumbers?.get(String(prompt.entry.sessionId)) || 1);
  await api("/api/review-activity-attempts", {
    method: "POST",
    body: JSON.stringify({
      session_id: prompt.entry.sessionId,
      activity_type: game.mode,
      set_number: setNumber,
      is_required_review: false,
      completed_at: practiceDate,
      result: {
        ask_teacher: true,
        practice_date: practiceDate,
        set_number: setNumber,
        source_sentence: prompt.sourceText,
        student_answer: game.translationDraft,
        natural_translation: prompt.targetText,
        chinese_translation: currentSentenceChineseTranslation(prompt),
      },
    }),
  });
  game.askTeacherSaved = true;
}

async function startNextSentenceTranslationSet() {
  const game = state.game;
  if (!game) return;
  const backendAttempts = await sentenceTranslationBackendAttempts();
  game.sessionSetNumbers = sentenceTranslationSessionSetNumbers(game.sourceItems || [], game.mode, backendAttempts);
  game.prompts = buildSentenceTranslationPrompts(game.sourceItems || [], game.isChineseToEnglish, game.sessionSetNumbers);
  game.index = 0;
  game.completionRecorded = false;
  game.clientAttemptId = null;
  if (!game.prompts.length) {
    renderEmptyState("This activity needs stored example During sentences with English and Chinese translations.");
    return;
  }
  prepareSentenceTranslationPrompt();
}

async function handleSentenceTranslationClick(event) {
  const game = state.game;
  if (game?.reading && game.clauseTree) return ReadingClauses.click(event);
  if (game?.reading) {
    if (event.target.closest('[data-reading-clause-upgrade]')) {
      ReadingClauses.reset(); game.clauseTree = ReadingClauses.create(currentSentencePrompt().sourceText);
      if (game.translationDraft.trim()) game.clauseTree.root.resolution = {status:'draft',stage:'order',chunks:[],order:[],translation:game.translationDraft};
      renderSentenceTranslationActivity({localOnly:true}); return;
    }
    if (game.finishing) return;
    const addTranslation = event.target.closest('[data-reading-add-connector-translation]');
    if (addTranslation) {
      const id = addTranslation.dataset.readingAddConnectorTranslation;
      (game.connectorExtraTranslations[id] ||= []).push('');
      renderSentenceTranslationActivity({localOnly: true});
      const inputs = [...document.querySelectorAll('[data-reading-extra-base]')].filter(el => el.dataset.readingExtraBase === id);
      inputs.at(-1)?.focus(); return;
    }
    if (event.target.closest('[data-reading-add-omitted]')) {
      if (!game.panels.length) buildPanelsFromConnectors();
      game.omittedConnectorDraftText = ''; game.omittedConnectorDraftPosition = null;
      game.omittedConnectorEditorOpen = true; renderSentenceTranslationActivity({localOnly: true}); return;
    }
    const omittedGap = event.target.closest('[data-reading-omitted-gap]');
    if (omittedGap) {
      game.omittedConnectorDraftPosition = Number(omittedGap.dataset.readingOmittedGap);
      renderSentenceTranslationActivity({localOnly: true});
      document.querySelector('[data-reading-omitted-word]')?.focus(); return;
    }
    if (event.target.closest('[data-reading-omitted-cancel]')) {
      game.omittedConnectorEditorOpen = false; renderSentenceTranslationActivity({localOnly: true}); return;
    }
    if (event.target.closest('[data-reading-omitted-apply]')) {
      const position = game.omittedConnectorDraftPosition, english = game.omittedConnectorDraftText.trim();
      if (!Number.isInteger(position) || position < 0 || position > game.panels.length || !english || english.length > 100 || /[\r\n\x00-\x1f]/.test(english)) return;
      const anchor = position === 0 ? 0 : position < game.panels.length ? game.panels[position].tokens[0].id : sentenceTranslationTokens(sentenceTranslationTextForPanels(), 'en').length;
      game.omittedConnectors.push({id: crypto.randomUUID(), anchor, english, translation: ''});
      game.omittedConnectorEditorOpen = false; renderSentenceTranslationActivity({localOnly: true}); return;
    }
    const removeOmitted = event.target.closest('[data-reading-remove-omitted]');
    if (removeOmitted) {
      const id = removeOmitted.dataset.readingRemoveOmitted;
      game.omittedConnectors = game.omittedConnectors.filter(entry => entry.id !== id);
      delete game.connectorExtraTranslations[`omitted:${id}`];
      game.chunkOrder = game.chunkOrder.filter(key => !key.startsWith(`omitted:${id}|extra:`));
      for (const key of Object.keys(game.chunkPunctuation)) if (key.startsWith(`omitted:${id}|extra:`)) delete game.chunkPunctuation[key];
      game.chunkOrder = game.chunkOrder.filter(key => key !== `omitted:${id}`); delete game.chunkPunctuation[`omitted:${id}`];
      renderSentenceTranslationActivity({localOnly: true}); return;
    }
    const punctuation = event.target.closest('[data-reading-chunk-punctuation]');
    if (punctuation && game.status === 'translate') {
      const id = punctuation.dataset.readingChunkPunctuation, mark = punctuation.dataset.readingPunctuationMark;
      if (!['，', '。'].includes(mark)) return;
      if (!readingTranslatedChunks().some(chunk => chunk.id === id && chunk.text.trim())) return;
      const current = game.chunkPunctuation[id] || '';
      const next = current.includes(mark) ? current.split(mark).join('') : current + mark;
      if (next) game.chunkPunctuation[id] = next; else delete game.chunkPunctuation[id];
      if (game.chunkOrder.includes(id)) updateReadingOrderedTranslation(); else renderSentenceTranslationActivity({localOnly: true});
      Array.from(document.querySelectorAll('[data-reading-chunk-punctuation]')).find(node => node.dataset.readingChunkPunctuation === id && node.dataset.readingPunctuationMark === mark)?.focus(); return;
    }
    const reposition = event.target.closest('[data-reading-reposition]');
    if (reposition && game.status === 'translate') {
      const id = reposition.dataset.readingReposition;
      if (!game.chunkOrder.includes(id)) return;
      game.reading.repositionChunkId = id; renderSentenceTranslationActivity({localOnly: true});
      document.querySelector('[data-reading-reposition-gap]')?.focus(); return;
    }
    if (event.target.closest('[data-reading-reposition-cancel]')) {
      game.reading.repositionChunkId = null; renderSentenceTranslationActivity({localOnly: true}); return;
    }
    const destination = event.target.closest('[data-reading-reposition-gap]');
    if (destination && game.status === 'translate' && game.reading.repositionChunkId) {
      const id = game.reading.repositionChunkId, order = game.chunkOrder.filter(key => key !== id);
      const position = Number(destination.dataset.readingRepositionGap);
      if (!Number.isInteger(position) || position < 0 || position > order.length) return;
      order.splice(position, 0, id); game.chunkOrder = order; game.reading.repositionChunkId = null;
      updateReadingOrderedTranslation(); return;
    }
    if (event.target.closest('[data-reading-fix-structure]')) {
      if (game.manualPanelBoundaries !== null) {
        game.structureDraftBoundaries = [...game.manualPanelBoundaries];
        game.structureDraftConnectors = [...(game.manualConnectorSegments || [])];
      } else {
        const tokens = sentenceTranslationTokens(sentenceTranslationTextForPanels(), 'en');
        const groups = selectedConnectorGroups(tokens, game.connectorSelection).filter(group => !isCommaBoundaryConnector(group.text));
        game.structureDraftBoundaries = [...new Set([...game.panels.slice(1).map(panel => panel.tokens[0].id), ...groups.flatMap(group => [group.start, group.end + 1])])].filter(id => id > 0 && id < tokens.length).sort((a, b) => a - b);
        game.structureDraftConnectors = groups.map(group => tokens.slice(group.start, group.end + 1).map(token => token.id).join(','));
      }
      game.structureEditorOpen = true; renderSentenceTranslationActivity({localOnly: true}); return;
    }
    const connectingSegment = event.target.closest('[data-reading-structure-connector]');
    if (connectingSegment) {
      const key = connectingSegment.dataset.readingStructureConnector, connecting = new Set(game.structureDraftConnectors);
      if (connecting.has(key)) connecting.delete(key); else connecting.add(key);
      game.structureDraftConnectors = [...connecting]; renderSentenceTranslationActivity({localOnly: true});
      document.querySelector(`[data-reading-structure-connector="${key}"]`)?.focus(); return;
    }
    const boundary = event.target.closest('[data-reading-structure-boundary]');
    if (boundary) {
      const id = Number(boundary.dataset.readingStructureBoundary), points = new Set(game.structureDraftBoundaries);
      if (points.has(id)) points.delete(id); else points.add(id);
      game.structureDraftBoundaries = [...points].sort((a, b) => a - b);
      renderSentenceTranslationActivity({localOnly: true});
      document.querySelector(`[data-reading-structure-boundary="${id}"]`)?.focus(); return;
    }
    if (event.target.closest('[data-reading-structure-cancel]')) {
      game.structureEditorOpen = false; renderSentenceTranslationActivity({localOnly: true}); return;
    }
    if (event.target.closest('[data-reading-structure-apply]')) { applyReadingStructure(); return; }
    const orderChunk = event.target.closest('[data-reading-order-chunk]');
    if (orderChunk && game.status === 'translate') {
      const id = orderChunk.dataset.readingOrderChunk;
      if (!readingTranslatedChunks().some(chunk => chunk.id === id && chunk.text.trim())) return;
      game.chunkOrder ||= [];
      const index = game.chunkOrder.indexOf(id);
      if (index >= 0) game.chunkOrder.splice(index, 1); else game.chunkOrder.push(id);
      updateReadingOrderedTranslation();
      Array.from(document.querySelectorAll('[data-reading-order-chunk]')).find(node => node.dataset.readingOrderChunk === id)?.focus();
      return;
    }
    if (event.target.closest('[data-reading-clear-order]')) {
      game.chunkOrder = []; game.chunkPunctuation = {}; updateReadingOrderedTranslation(); return;
    }
    const panelSave = event.target.closest('[data-reading-panel-save]');
    if (panelSave) {
      game.panels[Number(panelSave.dataset.readingPanelSave)].done = true;
      renderSentenceTranslationActivity();
      try { await game.reading.onCheckpoint(); }
      catch (error) { showAlert(`Panel was not saved to the database: ${error.message}`, true); }
      return;
    }
    if (event.target.closest('[data-reading-next]')) { await game.reading.onNext(); return; }
    if (event.target.closest('[data-reading-back]')) { await game.reading.onBack(); return; }
    if (event.target.closest('[data-finish-sentence-translation]')) {
      if (game.finishing || !game.translationDraft.trim()) return;
      game.finishing = true;
      const root = $("#review-activity");
      root.inert = true;
      try { await game.reading.onFinish(readingSentenceState()); game.resultOpen = true; renderSentenceTranslationActivity(); }
      catch (error) { showAlert(`Answer was not saved: ${error.message}`, true); }
      finally { game.finishing = false; root.inert = false; }
      return;
    }
  }
  if (!game || (game.mode !== "sentence-translation" && game.mode !== "chinese-english-translation")) return;
  const method = event.target.closest("[data-translation-method]");
  if (method) {
    game.method = method.dataset.translationMethod;
    if (game.method === "direct") {
      const confirmed = window.confirm(
        "Translate directly only when the helper method has been internalized and you do not need the extra visual UI. You should be able to split the sentence into panels and parts in your mind. Continue?",
      );
      if (!confirmed) {
        game.method = "";
        return;
      }
      game.status = "translate";
      game.translationCollapsed = false;
      renderSentenceTranslationActivity();
      requestAnimationFrame(() => $("[data-translation-draft]")?.focus());
      return;
    }
    game.status = game.isChineseToEnglish ? "owner-edit" : "connectors";
    renderSentenceTranslationActivity();
    return;
  }
  if (event.target.closest("[data-connector-help]")) {
    game.connectorHelpOpen = true;
    renderSentenceTranslationActivity();
    return;
  }
  if (event.target.closest("[data-close-connector-help]")) {
    game.connectorHelpOpen = false;
    renderSentenceTranslationActivity();
    return;
  }
  const connector = event.target.closest("[data-connector-token]");
  if (connector) {
    const id = Number(connector.dataset.connectorToken);
    if (game.connectorSelection.has(id)) game.connectorSelection.delete(id);
    else game.connectorSelection.add(id);
    renderSentenceTranslationActivity();
    return;
  }
  if (event.target.closest("[data-owner-edit-done]")) {
    game.status = "connectors";
    renderSentenceTranslationActivity();
    return;
  }
  if (event.target.closest("[data-build-panels]")) {
    buildPanelsFromConnectors();
    return;
  }
  const openPanel = event.target.closest("[data-open-panel]");
  if (openPanel) {
    openSentencePanel(Number(openPanel.dataset.openPanel));
    return;
  }
  if (event.target.closest("[data-close-panel]")) {
    game.activePanelIndex = null;
    game.selectedTokenIds = new Set();
    renderSentenceTranslationActivity();
    return;
  }
  const panelToken = event.target.closest("[data-panel-token]");
  if (panelToken) {
    const id = Number(panelToken.dataset.panelToken);
    if (game.selectedTokenIds.has(id)) {
      game.selectedTokenIds.delete(id);
      panelToken.classList.remove("pending-selected");
    } else {
      game.selectedTokenIds.add(id);
      panelToken.classList.add("pending-selected");
    }
    if (game.reading) game.reading.onChange(readingSentenceState());
    return;
  }
  const useSelection = event.target.closest("[data-use-selection]");
  if (useSelection) {
    assignSentenceSelection(useSelection.dataset.useSelection);
    return;
  }
  if (event.target.closest("[data-open-subject-finder]")) {
    game.subjectFinderOpen = true;
    game.subjectFinderTokenIds = new Set();
    renderSentenceTranslationActivity();
    return;
  }
  if (event.target.closest("[data-close-subject-finder]")) {
    game.subjectFinderOpen = false;
    game.subjectFinderTokenIds = new Set();
    renderSentenceTranslationActivity();
    return;
  }
  const subjectFinderToken = event.target.closest("[data-subject-finder-token]");
  if (subjectFinderToken) {
    const id = Number(subjectFinderToken.dataset.subjectFinderToken);
    if (game.subjectFinderTokenIds.has(id)) {
      game.subjectFinderTokenIds.delete(id);
      subjectFinderToken.classList.remove("pending-selected");
    } else {
      game.subjectFinderTokenIds.add(id);
      subjectFinderToken.classList.add("pending-selected");
    }
    if (game.reading) game.reading.onChange(readingSentenceState());
    return;
  }
  if (event.target.closest("[data-apply-subject-finder]")) {
    applySubjectFinderSelection();
    return;
  }
  const removePhrase = event.target.closest("[data-remove-modifier-answer], [data-remove-action-answer]");
  if (removePhrase) {
    const role = removePhrase.hasAttribute('data-remove-action-answer') ? 'action' : 'modifier';
    const panel = game.panels[game.activePanelIndex];
    if (panel) {
      const groups = Array.isArray(panel.answers[role]?.[0]) ? panel.answers[role] : panel.answers[role]?.length ? [panel.answers[role]] : [];
      groups.splice(Number(removePhrase.getAttribute(`data-remove-${role}-answer`)), 1);
      panel.answers[role] = groups;
      renderSentenceTranslationActivity();
    }
    return;
  }
  if (event.target.closest("[data-finish-panel]")) {
    finishSentencePanel();
    if (game.reading) {
      try { await game.reading.onCheckpoint(); }
      catch (error) { showAlert(`Panel was not saved to the database: ${error.message}`, true); }
    }
    return;
  }
  if (event.target.closest("[data-toggle-translation-float]")) {
    game.translationCollapsed = !game.translationCollapsed;
    renderSentenceTranslationActivity();
    if (!game.translationCollapsed) requestAnimationFrame(() => $("[data-translation-draft]")?.focus());
    return;
  }
  if (event.target.closest("[data-start-sentence-translation]")) {
    if (!allSentencePanelsComplete()) return;
    game.status = "translate";
    game.translationCollapsed = false;
    renderSentenceTranslationActivity();
    requestAnimationFrame(() => $("[data-translation-draft]")?.focus());
    return;
  }
  if (event.target.closest("[data-finish-sentence-translation]")) {
    game.resultOpen = true;
    if (game.index >= game.prompts.length - 1) {
      try {
        await recordSentenceTranslationCompletion();
      } catch (error) {
        game.resultOpen = false;
        showAlert(`Review completion was not saved: ${error.message}`, true);
      }
    }
    renderSentenceTranslationActivity();
    return;
  }
  if (event.target.closest("[data-next-sentence-prompt]")) {
    game.index += 1;
    prepareSentenceTranslationPrompt();
    return;
  }
  if (event.target.closest("[data-ask-teacher-help]")) {
    game.askTeacherHelpOpen = true;
    renderSentenceTranslationActivity();
    return;
  }
  if (event.target.closest("[data-close-ask-teacher-help]")) {
    game.askTeacherHelpOpen = false;
    renderSentenceTranslationActivity();
    return;
  }
  if (event.target.closest("[data-ask-teacher]")) {
    try {
      await recordAskTeacherRequest();
      showAlert("Ask Teacher request saved.");
    } catch (error) {
      showAlert(`Ask Teacher request was not saved: ${error.message}`, true);
    }
    renderSentenceTranslationActivity();
    return;
  }
  if (event.target.closest("[data-next-sentence-set]")) {
    await startNextSentenceTranslationSet();
    return;
  }
  if (event.target.closest("[data-retry-sentence-prompt]")) {
    prepareSentenceTranslationPrompt();
    return;
  }
  if (event.target.closest("[data-translation-back]")) {
    goBackSentenceTranslationStep();
  }
}

function handleSentenceTranslationInput(event) {
  const game = state.game;
  if (!game || (game.mode !== "sentence-translation" && game.mode !== "chinese-english-translation")) return;
  if (game.reading && game.clauseTree) return ReadingClauses.input(event);
  const omittedWord = event.target.closest('[data-reading-omitted-word]');
  if (game.reading && omittedWord) {
    game.omittedConnectorDraftText = omittedWord.value;
    const submit = document.querySelector('[data-reading-omitted-apply]');
    if (submit) submit.disabled = game.omittedConnectorDraftPosition === null || !omittedWord.value.trim();
    game.reading.onChange(readingSentenceState(), {autosave: false}); return;
  }
  const extraTranslation = event.target.closest('[data-reading-extra-base]');
  if (game.reading && extraTranslation) {
    game.connectorExtraTranslations[extraTranslation.dataset.readingExtraBase][Number(extraTranslation.dataset.readingExtraIndex)] = extraTranslation.value;
    game.reading.onChange(readingSentenceState(), {autosave: false}); return;
  }
  const omittedTranslation = event.target.closest('[data-reading-omitted-translation]');
  if (game.reading && omittedTranslation) {
    const entry = game.omittedConnectors.find(row => row.id === omittedTranslation.dataset.readingOmittedTranslation);
    if (entry) { entry.translation = omittedTranslation.value; game.reading.onChange(readingSentenceState(), {autosave: false}); }
    return;
  }
  const chunkInput = event.target.closest('[data-reading-chunk-key]');
  if (game.reading && chunkInput) {
    const panel = game.panels[Number(chunkInput.dataset.readingChunkPanel)];
    if (!panel) return;
    panel.chunkTranslations ||= {};
    panel.chunkTranslations[chunkInput.dataset.readingChunkKey] = chunkInput.value;
    game.reading.onChange(readingSentenceState());
    return;
  }
  const ownerEdit = event.target.closest("[data-owner-edit]");
  if (ownerEdit) {
    const prompt = currentSentencePrompt();
    if (prompt) prompt.ownerEditedText = ownerEdit.value;
    return;
  }
  const translationDraft = event.target.closest("[data-translation-draft]");
  if (translationDraft) {
    game.translationDraft = translationDraft.value;
    const button = $("[data-finish-sentence-translation]");
    if (button) button.disabled = !game.translationDraft.trim();
    if (game.reading) game.reading.onChange(readingSentenceState());
  }
}

if (typeof registerReviewActivity === 'function') registerReviewActivity("sentence-translation", {
  initialize: (gameItems) => initializeSentenceComicTranslation(gameItems, "sentence-translation"),
  handleClick: handleSentenceTranslationClick,
  handleInput: handleSentenceTranslationInput,
  handleStageBack: backToSentenceTranslationMethodChoice,
});

if (typeof registerReviewActivity === 'function') registerReviewActivity("chinese-english-translation", {
  initialize: (gameItems) => initializeSentenceComicTranslation(gameItems, "chinese-english-translation"),
  handleClick: handleSentenceTranslationClick,
  handleInput: handleSentenceTranslationInput,
  handleStageBack: backToSentenceTranslationMethodChoice,
});
