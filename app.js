// ==========================================
// 智能健康语音助理 - 核心逻辑 (app.js)
// ==========================================

// --- 全局配置与状态 ---
let db = null;
let mediaRecorder = null;
let speechRecognitionObj = null;
let isRecordingForNote = true; // true 为语音录入，false 为语音问诊
let activeSynthesisUtterance = null;
let speechResultBuffer = "";

// 默认及多模型参数配置
const SETTINGS = {
  provider: localStorage.getItem('llm_provider') || 'gemini',
  apiUrl: localStorage.getItem('llm_api_url') || '',
  modelName: localStorage.getItem('llm_model_name') || 'gemini-2.5-flash',
  apiKey: localStorage.getItem('llm_api_key') || '',
  voiceRate: parseFloat(localStorage.getItem('voice_rate')) || 0.85,
  textSize: localStorage.getItem('text_size') || 'large'
};

// --- DOM 元素引用 ---
const elements = {
  btnSettings: document.getElementById('btn-settings'),
  apiKeyBanner: document.getElementById('api-key-banner'),
  
  // 主功能卡片
  actionRecord: document.getElementById('action-record'),
  actionAsk: document.getElementById('action-ask'),
  actionUpload: document.getElementById('action-upload'),
  fileInput: document.getElementById('file-input'),
  recordsList: document.getElementById('records-list'),
  tabButtons: document.querySelectorAll('.tab-button'),
  
  // 设置弹窗
  modalSettings: document.getElementById('modal-settings'),
  btnCloseSettings: document.getElementById('btn-close-settings'),
  selectProvider: document.getElementById('select-provider'),
  inputApiUrl: document.getElementById('input-api-url'),
  inputModelName: document.getElementById('input-model-name'),
  inputApiKey: document.getElementById('input-api-key'),
  selectVoiceRate: document.getElementById('select-voice-rate'),
  selectTextSize: document.getElementById('select-text-size'),
  btnSaveSettings: document.getElementById('btn-save-settings'),
  btnClearDb: document.getElementById('btn-clear-db'),
  btnExportDb: document.getElementById('btn-export-db'),
  btnImportDb: document.getElementById('btn-import-db'),
  importDbInput: document.getElementById('import-db-input'),
  
  // 语音识别录音弹窗
  modalSpeech: document.getElementById('modal-speech'),
  btnCloseSpeech: document.getElementById('btn-close-speech'),
  speechModalTitle: document.getElementById('speech-modal-title'),
  speechModalHint: document.getElementById('speech-modal-hint'),
  speechTranscriptText: document.getElementById('speech-transcript-text'),
  btnSpeechStop: document.getElementById('btn-speech-stop'),
  
  // 录入确认弹窗
  modalRecordConfirm: document.getElementById('modal-record-confirm'),
  btnCloseConfirm: document.getElementById('btn-close-confirm'),
  confirmRecordText: document.getElementById('confirm-record-text'),
  btnConfirmCancel: document.getElementById('btn-confirm-cancel'),
  btnConfirmSave: document.getElementById('btn-confirm-save'),
  
  // 问诊回答弹窗
  modalAnswer: document.getElementById('modal-answer'),
  btnCloseAnswer: document.getElementById('btn-close-answer'),
  answerQuestionText: document.getElementById('answer-question-text'),
  ttsAudioIndicator: document.getElementById('tts-audio-indicator'),
  answerLoading: document.getElementById('answer-loading'),
  answerContentArea: document.getElementById('answer-content-area'),
  btnAnswerReplay: document.getElementById('btn-answer-replay'),
  btnAnswerClose: document.getElementById('btn-answer-close'),
  
  // 文档详情弹窗
  modalDocDetail: document.getElementById('modal-doc-detail'),
  btnCloseDoc: document.getElementById('btn-close-doc'),
  docTitleText: document.getElementById('doc-title-text'),
  docTypeTag: document.getElementById('doc-type-tag'),
  docTimeText: document.getElementById('doc-time-text'),
  docPreviewContainer: document.getElementById('doc-preview-container'),
  docSummaryContent: document.getElementById('doc-summary-content'),
  btnDocDelete: document.getElementById('btn-doc-delete'),
  btnDocClose: document.getElementById('btn-doc-close'),
  
  // 全局加载遮罩
  globalLoading: document.getElementById('global-loading'),
  loadingMsgTitle: document.getElementById('loading-msg-title'),
  loadingMsgDesc: document.getElementById('loading-msg-desc'),
  
  // 自定义确认对话框
  modalCustomConfirm: document.getElementById('modal-custom-confirm'),
  customConfirmTitle: document.getElementById('custom-confirm-title'),
  customConfirmMessage: document.getElementById('custom-confirm-message'),
  btnCustomConfirmOk: document.getElementById('btn-custom-confirm-ok'),
  btnCustomConfirmCancel: document.getElementById('btn-custom-confirm-cancel'),
  btnCustomConfirmClose: document.getElementById('btn-custom-confirm-close')
};

// --- 初始化程序 ---
document.addEventListener('DOMContentLoaded', async () => {
  applyTextSize(SETTINGS.textSize);
  initSettingsUI();
  checkApiKeyStatus();
  await initDatabase();
  renderRecordsList();
  initSpeechRecognition();
  bindEvents();
});


// --- 样式字号管理 ---
function applyTextSize(size) {
  document.body.className = `text-size-${size}`;
  SETTINGS.textSize = size;
  localStorage.setItem('text_size', size);
}

const PROVIDER_DEFAULTS = {
  gemini: {
    url: '',
    model: 'gemini-2.5-flash'
  },
  deepseek: {
    url: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat'
  },
  qwen: {
    url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus'
  },
  doubao: {
    url: 'https://ark.cn-beijing.volces.com/api/v3',
    model: ''
  },
  openai: {
    url: '',
    model: ''
  }
};

function initSettingsUI() {
  elements.selectProvider.value = SETTINGS.provider;
  elements.inputApiUrl.value = SETTINGS.apiUrl;
  elements.inputModelName.value = SETTINGS.modelName;
  elements.inputApiKey.value = SETTINGS.apiKey;
  elements.selectVoiceRate.value = SETTINGS.voiceRate;
  elements.selectTextSize.value = SETTINGS.textSize;
}

function checkApiKeyStatus() {
  if (!SETTINGS.apiKey) {
    elements.apiKeyBanner.classList.remove('hidden');
  } else {
    elements.apiKeyBanner.classList.add('hidden');
  }
}

// --- PDF.js 初始化 & 文本提取 ---
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
}

async function extractTextFromPDF(fileDataUrl) {
  if (!window.pdfjsLib) {
    throw new Error("客户端 PDF 解析库加载失败，请检查网络连接。");
  }
  const base64Data = fileDataUrl.split(',')[1];
  const binaryStr = atob(base64Data);
  const len = binaryStr.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  
  const loadingTask = pdfjsLib.getDocument({ data: bytes });
  const pdf = await loadingTask.promise;
  let extractedText = '';
  
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const strings = textContent.items.map(item => item.str);
    extractedText += strings.join(' ') + '\n';
  }
  return extractedText.trim();
}

// --- IndexedDB 本地数据库管理 ---
function initDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('HealthAssistantDB', 1);
    
    request.onerror = (e) => {
      console.error('数据库打开失败:', e);
      alert('无法打开本地数据库，部分功能可能受限。');
      reject(e);
    };
    
    request.onsuccess = (e) => {
      db = e.target.result;
      console.log('数据库打开成功');
      resolve(db);
    };
    
    request.onupgradeneeded = (e) => {
      const database = e.target.result;
      
      // 创建就医笔记表
      if (!database.objectStoreNames.contains('records')) {
        database.createObjectStore('records', { keyPath: 'id', autoIncrement: true });
      }
      // 创建健康文档表(图片/PDF等)
      if (!database.objectStoreNames.contains('documents')) {
        database.createObjectStore('documents', { keyPath: 'id', autoIncrement: true });
      }
      console.log('数据库结构初始化完成');
    };
  });
}

// 保存就医笔记
function saveNoteToDB(text) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['records'], 'readwrite');
    const store = transaction.objectStore('records');
    const record = {
      type: 'note',
      content: text,
      timestamp: Date.now()
    };
    
    const request = store.add(record);
    request.onsuccess = () => resolve(true);
    request.onerror = (e) => reject(e);
  });
}

// 保存健康文档
function saveDocToDB(name, fileType, fileData, summary) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['documents'], 'readwrite');
    const store = transaction.objectStore('documents');
    const doc = {
      type: 'file',
      name: name,
      fileType: fileType,
      fileData: fileData, // DataURL (Base64)
      summary: summary,
      timestamp: Date.now()
    };
    
    const request = store.add(doc);
    request.onsuccess = () => resolve(true);
    request.onerror = (e) => reject(e);
  });
}

// 获取所有数据并按时间倒序排列
function getAllItems() {
  return new Promise((resolve) => {
    const items = [];
    let recordsFinished = false;
    let docsFinished = false;
    
    const checkFinished = () => {
      if (recordsFinished && docsFinished) {
        // 排序：最新录入在最前
        items.sort((a, b) => b.timestamp - a.timestamp);
        resolve(items);
      }
    };
    
    // 读取 records
    const txRecords = db.transaction(['records'], 'readonly');
    const storeRecords = txRecords.objectStore('records');
    const reqRecords = storeRecords.openCursor();
    
    reqRecords.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        items.push(cursor.value);
        cursor.continue();
      } else {
        recordsFinished = true;
        checkFinished();
      }
    };
    reqRecords.onerror = () => {
      recordsFinished = true;
      checkFinished();
    };

    // 读取 documents
    const txDocs = db.transaction(['documents'], 'readonly');
    const storeDocs = txDocs.objectStore('documents');
    const reqDocs = storeDocs.openCursor();
    
    reqDocs.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        items.push(cursor.value);
        cursor.continue();
      } else {
        docsFinished = true;
        checkFinished();
      }
    };
    reqDocs.onerror = () => {
      docsFinished = true;
      checkFinished();
    };
  });
}

// 删除某条记录
function deleteItemFromDB(id, type) {
  console.log('[DELETE] deleteItemFromDB called with id=', id, 'type=', typeof id, 'itemType=', type);
  return new Promise((resolve, reject) => {
    const storeName = type === 'note' ? 'records' : 'documents';
    const transaction = db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    
    // 先验证 item 存在
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      if (!getReq.result) {
        console.warn('[DELETE] 没有找到 id=' + id + ' 的记录，可能 key 类型不匹配');
      } else {
        console.log('[DELETE] 找到记录，准备删除:', getReq.result.content?.substring(0, 30) || getReq.result.name);
      }
      const delReq = store.delete(id);
      delReq.onsuccess = () => {
        console.log('[DELETE] store.delete() onsuccess');
      };
      delReq.onerror = (e) => {
        console.error('[DELETE] store.delete() onerror:', e.target.error);
      };
    };
    
    transaction.oncomplete = () => {
      console.log('[DELETE] 删除事务完成');
      resolve(true);
    };
    transaction.onerror = (e) => {
      console.error('[DELETE] 删除事务出错:', e.target.error);
      reject(e.target.error || e);
    };
    transaction.onabort = () => {
      console.error('[DELETE] 删除事务被中止');
      reject(new Error('删除事务被中止'));
    };
  });
}

// 自定义确认对话框 (替代原生 confirm，避免兼容性问题)
function showConfirm(message, title) {
  return new Promise((resolve) => {
    elements.customConfirmTitle.innerText = title || '确认操作';
    elements.customConfirmMessage.innerText = message;
    showModal(elements.modalCustomConfirm);
    
    // 清除之前的事件监听
    const onConfirm = () => {
      cleanup();
      hideModal(elements.modalCustomConfirm);
      resolve(true);
    };
    const onCancel = () => {
      cleanup();
      hideModal(elements.modalCustomConfirm);
      resolve(false);
    };
    const cleanup = () => {
      elements.btnCustomConfirmOk.removeEventListener('click', onConfirm);
      elements.btnCustomConfirmCancel.removeEventListener('click', onCancel);
      elements.btnCustomConfirmClose.removeEventListener('click', onCancel);
    };
    
    elements.btnCustomConfirmOk.addEventListener('click', onConfirm);
    elements.btnCustomConfirmCancel.addEventListener('click', onCancel);
    elements.btnCustomConfirmClose.addEventListener('click', onCancel);
  });
}

// 获取单个文件详情
function getDocFromDB(id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['documents'], 'readonly');
    const store = transaction.objectStore('documents');
    const request = store.get(id);
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e);
  });
}

function clearAllDBData() {
  console.log("[DEBUG] clearAllDBData: 开始清空数据库...");
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(['records', 'documents'], 'readwrite');
      console.log("[DEBUG] clearAllDBData: 交易已创建");
      tx.objectStore('records').clear();
      console.log("[DEBUG] clearAllDBData: records.clear() 已排队");
      tx.objectStore('documents').clear();
      console.log("[DEBUG] clearAllDBData: documents.clear() 已排队");
      
      tx.oncomplete = () => {
        console.log("[DEBUG] clearAllDBData: 交易完成，数据库已清空");
        resolve(true);
      };
      tx.onerror = (e) => {
        console.error("[DEBUG] clearAllDBData: 交易出错:", e.target.error || e);
        reject(e.target.error || e);
      };
      tx.onabort = (e) => {
        console.warn("[DEBUG] clearAllDBData: 交易被中止");
        reject(new Error("清空数据库事务被中止"));
      };
    } catch (err) {
      console.error("[DEBUG] clearAllDBData: 创建交易异常:", err);
      reject(err);
    }
  });
}


// --- 语音识别 (STT) 与 语音合成 (TTS) ---

// 初始化浏览器语音识别对象
function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  
  if (!SpeechRecognition) {
    console.warn('当前浏览器不支持 Web Speech API 语音识别。已开启文本备用模式。');
    return;
  }
  
  speechRecognitionObj = new SpeechRecognition();
  speechRecognitionObj.continuous = true;
  speechRecognitionObj.interimResults = true;
  speechRecognitionObj.lang = 'zh-CN';
  
  speechRecognitionObj.onstart = () => {
    console.log('语音识别启动...');
    speechResultBuffer = "";
    elements.speechModalHint.innerText = "请开始说话，正在聆听您的声音...";
  };
  
  speechRecognitionObj.onresult = (event) => {
    let interimTranscript = '';
    let finalTranscript = '';
    
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        finalTranscript += event.results[i][0].transcript;
      } else {
        interimTranscript += event.results[i][0].transcript;
      }
    }
    
    if (finalTranscript) {
      speechResultBuffer += finalTranscript;
    }
    
    elements.speechTranscriptText.value = speechResultBuffer + interimTranscript;
    // 滚动到底部
    elements.speechTranscriptText.scrollTop = elements.speechTranscriptText.scrollHeight;
  };
  
  speechRecognitionObj.onerror = (event) => {
    console.error('语音识别出错:', event.error);
    if (event.error === 'no-speech') {
      elements.speechModalHint.innerText = "没有检测到声音，请尝试再靠近麦克风一些说话。";
    } else if (event.error === 'not-allowed') {
      elements.speechModalHint.innerText = "麦克风权限被拒绝，请在浏览器地址栏上方允许权限。";
      speakText("请开启麦克风权限以使用语音录入。");
    } else {
      elements.speechModalHint.innerText = `识别出错: ${event.error}，您可以手动输入或修改文本。`;
    }
  };
  
  speechRecognitionObj.onend = () => {
    console.log('语音识别结束。');
  };
}

// 启动录音
function startVoiceRecognition(forNote) {
  isRecordingForNote = forNote;
  elements.speechTranscriptText.value = "";
  
  if (!speechRecognitionObj) {
    // 如果浏览器不支持，直接弹窗让用户打字
    showFallbackInput(forNote);
    return;
  }
  
  if (forNote) {
    elements.speechModalTitle.innerText = "语音录入健康信息";
  } else {
    elements.speechModalTitle.innerText = "语音健康检索问诊";
  }
  
  showModal(elements.modalSpeech);
  
  try {
    speechRecognitionObj.start();
  } catch(e) {
    console.error("启动语音识别失败:", e);
    // 重复调用 start 会抛异常，先 stop 一下再试
    speechRecognitionObj.stop();
    setTimeout(() => { speechRecognitionObj.start(); }, 300);
  }
}

// 停止录音并处理结果
function stopVoiceRecognition() {
  if (speechRecognitionObj) {
    speechRecognitionObj.stop();
  }
  
  hideModal(elements.modalSpeech);
  
  const text = elements.speechTranscriptText.value.trim();
  
  if (!text) {
    speakText("没有听清您的声音，请重试。");
    alert("未检测到语音内容，请重试。");
    return;
  }
  
  if (isRecordingForNote) {
    // 语音录入 -> 弹出编辑确认框
    elements.confirmRecordText.value = text;
    showModal(elements.modalRecordConfirm);
  } else {
    // 语音问诊 -> 直接调取 AI 检索回答
    handleVoiceQuery(text);
  }
}

// 备用文本输入模式
function showFallbackInput(forNote) {
  const promptMsg = forNote 
    ? "当前浏览器不支持语音输入。请直接在下方输入您的就医或用药信息：" 
    : "当前浏览器不支持语音输入。请在下方输入您要提问的问题：";
    
  const userText = prompt(promptMsg, "");
  if (!userText || !userText.trim()) return;
  
  if (forNote) {
    elements.confirmRecordText.value = userText.trim();
    showModal(elements.modalRecordConfirm);
  } else {
    handleVoiceQuery(userText.trim());
  }
}

// 语音合成播报 (TTS)
function speakText(text, onStart, onEnd) {
  if (!window.speechSynthesis) {
    console.warn("当前浏览器不支持 Speech Synthesis 语音播报");
    return;
  }
  
  // 取消当前的播报
  window.speechSynthesis.cancel();
  
  if (!text) return;
  
  activeSynthesisUtterance = new SpeechSynthesisUtterance(text);
  activeSynthesisUtterance.rate = SETTINGS.voiceRate;
  activeSynthesisUtterance.lang = 'zh-CN';
  
  activeSynthesisUtterance.onstart = () => {
    if (onStart) onStart();
    elements.ttsAudioIndicator.classList.remove('hidden');
  };
  
  activeSynthesisUtterance.onend = () => {
    if (onEnd) onEnd();
    elements.ttsAudioIndicator.classList.add('hidden');
    activeSynthesisUtterance = null;
  };
  
  activeSynthesisUtterance.onerror = (e) => {
    console.error("语音播报出错:", e);
    elements.ttsAudioIndicator.classList.add('hidden');
    activeSynthesisUtterance = null;
  };
  
  window.speechSynthesis.speak(activeSynthesisUtterance);
}

// 停止当前播音
function stopSpeaking() {
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
    elements.ttsAudioIndicator.classList.add('hidden');
  }
}


// --- 多模型大语言模型 API 调用封装 ---
async function callLLM(prompt, systemInstruction = "", files = []) {
  if (!SETTINGS.apiKey) {
    throw new Error("APIKEY_MISSING");
  }
  
  if (SETTINGS.provider === 'gemini') {
    // ========== Google Gemini 原生协议 ==========
    const base = SETTINGS.apiUrl || 'https://generativelanguage.googleapis.com';
    const endpoint = `${base}/v1beta/models/${SETTINGS.modelName}:generateContent?key=${SETTINGS.apiKey}`;
    console.log('[API] Gemini 请求端点:', endpoint.replace(SETTINGS.apiKey, '***KEY***'));
    
    const contents = [];
    const parts = [];
    parts.push({ text: prompt });
    
    if (files && files.length > 0) {
      files.forEach(file => {
        parts.push({
          inlineData: {
            mimeType: file.mimeType,
            data: file.base64Data
          }
        });
      });
    }
    
    contents.push({ role: 'user', parts: parts });
    
    const requestBody = {
      contents: contents,
      generationConfig: {
        temperature: 0.3
      }
    };
    
    if (systemInstruction) {
      requestBody.systemInstruction = {
        parts: [{ text: systemInstruction }]
      };
    }
    
    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });
    } catch (networkErr) {
      console.error('[API] 网络请求失败:', networkErr);
      throw new Error(`网络连接失败，请检查网络连接是否正常。错误详情：${networkErr.message}`);
    }
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const apiErrMsg = errorData.error?.message || `HTTP ${response.status}`;
      console.error('[API] Gemini API 返回错误:', response.status, apiErrMsg);
      throw new Error(`Gemini API 请求失败 (${response.status})：${apiErrMsg}`);
    }
    
    const result = await response.json();
    const candidate = result.candidates?.[0];
    if (!candidate || !candidate.content?.parts) {
      console.error('[API] Gemini 返回了空的回答:', JSON.stringify(result).substring(0, 200));
      throw new Error("Gemini 返回了空的回答内容。");
    }
    return candidate.content.parts.map(p => p.text).join('');
    
  } else {
    // ========== OpenAI 兼容协议 (DeepSeek / 通义千问 / 豆包 / 自定义) ==========
    const defaults = PROVIDER_DEFAULTS[SETTINGS.provider] || {};
    const baseUrl = (SETTINGS.apiUrl || defaults.url || '').replace(/\/+$/, '');
    
    if (!baseUrl) {
      throw new Error("请在设置中配置 API 接口地址。");
    }
    
    const chatEndpoint = `${baseUrl}/chat/completions`;
    const messages = [];
    if (systemInstruction) {
      messages.push({ role: 'system', content: systemInstruction });
    }
    
    const hasImages = files && files.some(f => f.mimeType.startsWith('image/'));
    if (hasImages) {
      const userContent = [{ type: 'text', text: prompt }];
      files.forEach(file => {
        if (file.mimeType.startsWith('image/')) {
          userContent.push({
            type: 'image_url',
            image_url: {
              url: `data:${file.mimeType};base64,${file.base64Data}`
            }
          });
        }
      });
      messages.push({ role: 'user', content: userContent });
    } else {
      messages.push({ role: 'user', content: prompt });
    }
    
    const requestBody = {
      model: SETTINGS.modelName || defaults.model || '',
      messages: messages,
      temperature: 0.3
    };
    
    let response;
    try {
      response = await fetch(chatEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SETTINGS.apiKey}`
        },
        body: JSON.stringify(requestBody)
      });
    } catch (networkErr) {
      console.error('[API] 网络请求失败:', networkErr);
      throw new Error(`网络连接失败，请检查网络连接是否正常。错误详情：${networkErr.message}`);
    }
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const apiErrMsg = errorData.error?.message || errorData.message || `HTTP ${response.status}`;
      console.error('[API] OpenAI兼容 API 返回错误:', response.status, apiErrMsg);
      throw new Error(`API 请求失败 (${response.status})：${apiErrMsg}`);
    }
    
    const result = await response.json();
    return result.choices?.[0]?.message?.content || "抱歉，未能生成有效的回答内容。";
  }
}

// --- 核心业务功能实现 ---

// 1. 就医记录保存
async function saveVoiceNote() {
  const text = elements.confirmRecordText.value.trim();
  if (!text) {
    alert("保存内容不能为空。");
    return;
  }
  
  try {
    showGlobalLoading("正在保存", "正在将您的看病记录加密保存到本地...");
    await saveNoteToDB(text);
    hideGlobalLoading();
    hideModal(elements.modalRecordConfirm);
    
    speakText("您的看病记录已经成功保存。");
    renderRecordsList();
  } catch(e) {
    console.error("保存失败:", e);
    hideGlobalLoading();
    alert("保存失败，请重试。");
  }
}

// 2. 健康文件上传与 AI 解析
async function handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  if (!SETTINGS.apiKey) {
    speakText("请先配置请先配置 API Key");
    alert("请先在右上角设置中配置您的大模型服务商与请先配置 API Key 才能自动提取并分析健康文件。");
    elements.fileInput.value = ""; // 清空 file input
    showModal(elements.modalSettings);
    return;
  }
  
  showGlobalLoading("分析文件中", "AI 正在努力提取报告和病历中的医学信息，这可能需要 5-15 秒...");
  
  const fileReader = new FileReader();
  
  fileReader.onload = async (event) => {
    const fileDataUrl = event.target.result;
    const mimeType = file.type;
    
    try {
      let docSummary = "";
      
      // 区分文本、非 Gemini PDF 和二进制多模态文件
      if (mimeType.startsWith('text/')) {
        // 文本文件直接读取文字发给 LLM
        const textContent = atob(fileDataUrl.split(',')[1]);
        const decodedText = decodeURIComponent(escape(textContent)); // 处理中文乱码
        
        const textPrompt = `请分析以下健康文档的内容，提取出：
1. 关键医疗日期；
2. 医院或科室信息；
3. 诊断结论/健康指标；
4. 处方药物/治疗方案；
5. 特别医嘱。
请用条理清晰、排版美观且通俗易懂的中文摘要出来，字数控制在 250 字左右。

文档原文：
${decodedText}`;
        
        docSummary = await callLLM(textPrompt, "你是一个专业的医疗健康档案助手");
      } else if (mimeType === 'application/pdf' && SETTINGS.provider !== 'gemini') {
        // 非 Gemini 模型上传 PDF：利用 pdf.js 进行客户端本地文本提取后进行处理
        console.log("[DEBUG] 正在通过客户端提取 PDF 文本...");
        const decodedText = await extractTextFromPDF(fileDataUrl);
        console.log("[DEBUG] PDF 文本提取成功，字符长度:", decodedText.length);
        
        if (!decodedText) {
          throw new Error("无法从 PDF 文件中提取出文本内容，文件可能已损坏或为纯扫描版图像。若是扫描版文件，请尝试保存为图片形式上传并使用多模态模型解析。");
        }
        
        const textPrompt = `请分析以下健康文档（由客户端提取的 PDF）的内容，提取并整理出以下核心信息：
1. 就医/报告日期；
2. 医院或科室信息；
3. 诊断结论/疾病诊断/主要症状；
4. 开具的所有药品清单（包含名称、服用频次及计量）或治疗方案；
5. 化验单中的异常指标项（偏高/偏低）；
6. 医生的特别医嘱和日常注意事项。

请用条理清晰、排版美观、字体易读的中文格式归纳整理，确保用户能一眼看明白。字数控制在 250 字左右。

PDF 提取的文本内容如下：
${decodedText}`;
        
        docSummary = await callLLM(textPrompt, "你是一个专业的医学助理，能够精准归纳分析就医病历及各类医学报告");
      } else {
        // 图片 (PNG/JPG/WEBP) 或 Gemini 原生多模态 PDF
        if (SETTINGS.provider === 'deepseek' && mimeType.startsWith('image/')) {
          // 友好捕获 DeepSeek 官方模型对图片的限制
          throw new Error("您选择的 DeepSeek 官方默认模型不支持图片上传分析。请上传 PDF/文本格式文件，或在设置中切换为支持图片的多模态模型（如 Google Gemini 或通义千问多模态模型）。");
        }
        
        const base64Data = fileDataUrl.split(',')[1];
        
        const multimediaPrompt = `请帮我仔细阅读并分析这份上传的健康文件（可能是一张药方图片、化验单、检查报告或PDF病历）。
请提取并整理出以下核心信息：
1. 就医/报告日期；
2. 医院或科室信息；
3. 诊断结论/疾病诊断/主要症状；
4. 开具的所有药品清单（包含名称、服用频次及计量）或治疗方案；
5. 化验单中的异常指标项（偏高/偏低）；
6. 医生的特别医嘱和日常注意事项。

请用条理清晰、排版美观、字体易读的中文格式排版，确保用户能一眼看明白。字数控制在 250 字左右。`;
        
        const fileObj = {
          mimeType: mimeType || 'application/octet-stream',
          base64Data: base64Data
        };
        
        docSummary = await callLLM(multimediaPrompt, "你是一个专业的医学助理，能够精准识别和翻译各种复杂的检验报告单和药方", [fileObj]);
      }
      
      // 保存到 IndexedDB
      await saveDocToDB(file.name, mimeType, fileDataUrl, docSummary);
      
      hideGlobalLoading();
      elements.fileInput.value = ""; // 清空 file input
      speakText("文件已成功分析并归档。");
      renderRecordsList();
      
    } catch(err) {
      console.error("处理文件上传出错:", err);
      hideGlobalLoading();
      elements.fileInput.value = "";
      
      let errMsg = err.message || "解析文件失败，请确保文件是清晰的图片、PDF或文本文档，并检查您的请先配置 API Key 是否有效。";
      if (err.message === 'APIKEY_MISSING') {
        errMsg = "请在设置中配置您的大模型请先配置 API Key 后重试。";
      }
      
      speakText("文件分析出错");
      alert(errMsg);
    }
  };
  
  fileReader.onerror = () => {
    hideGlobalLoading();
    alert("读取本地文件失败，请重试。");
  };
  
  fileReader.readAsDataURL(file);
}

// 3. 语音提问与检索解答 (RAG 问答)
async function handleVoiceQuery(questionText) {
  if (!SETTINGS.apiKey) {
    speakText("请先配置请先配置 API Key");
    alert("智能检索问诊功能需要请先配置 API Key，请在右上角设置中完成配置。");
    showModal(elements.modalSettings);
    return;
  }
  
  // 填充问题回放
  elements.answerQuestionText.innerText = questionText;
  elements.answerContentArea.innerText = "";
  
  // 打开回答弹窗，显示思考中
  showModal(elements.modalAnswer);
  elements.answerLoading.classList.remove('hidden');
  elements.btnAnswerReplay.classList.add('hidden');
  
  try {
    // 1. 从 IndexedDB 提取所有记录拼成上下文
    const allRecords = await getAllItems();
    
    if (allRecords.length === 0) {
      // 没数据的情况
      elements.answerLoading.classList.add('hidden');
      const emptyText = "您的本地档案库中还没有录入任何就医记录或健康文档。根据我的知识库建议，如果您有健康疑问，建议前往医院就诊。";
      elements.answerContentArea.innerText = emptyText;
      elements.btnAnswerReplay.classList.remove('hidden');
      speakText(emptyText);
      return;
    }
    
    // 整理上下文
    let contextParts = [];
    allRecords.forEach((item, index) => {
      const dateStr = new Date(item.timestamp).toLocaleString('zh-CN', { hour12: false });
      if (item.type === 'note') {
        contextParts.push(`记录 #${index+1}【口述就医记录】\n时间：${dateStr}\n内容：${item.content}`);
      } else {
        contextParts.push(`记录 #${index+1}【上传文件：${item.name}】\n时间：${dateStr}\nAI解析摘要：${item.summary}`);
      }
    });
    
    const context = contextParts.join('\n\n-------------------\n\n');
    
    // 2. 发送给 LLM
    const systemPrompt = `你是一个贴心温和的随身健康助理。
以下是用户的全部历史健康记录、用药和报告情况：

${context}

你的任务是：根据用户的历史记录，回答他们提出的健康疑问。
请严格遵守以下回答指南：
1. 语言必须极其温和、亲切、简单，适合用户阅读与收听，充满关怀。绝对不要在回答中称呼用户为"老人家"、"老人"或"老爷爷/老奶奶"等，请直接使用"您"来称呼。
2. 直接回答问题，重点突出。如果用户询问某项药物怎么吃，或者之前某天为什么不舒服，在历史记录中检索并明确给出。
3. 答案一定要保持简短，必须在 120 字以内！因为这需要用语音念出来，太长的回答用户记不住，听着也累。
4. 不要包含复杂的列表、特殊符号、星号标记、化学式或大量的英文。
5. 如果在提供的记录中没有找到相关答案，请明确且委婉地告诉用户，并结合医学常识给予一般性的关怀建议（同样需控制在 120 字内）。`;

    const responseText = await callLLM(questionText, systemPrompt);
    
    // 3. 渲染回答并播放语音音
    elements.answerLoading.classList.add('hidden');
    elements.answerContentArea.innerText = responseText;
    elements.btnAnswerReplay.classList.remove('hidden');
    
    // 自动播放回答语音
    speakText(responseText);
    
  } catch(err) {
    console.error("健康问诊检索出错：", err);
    elements.answerLoading.classList.add('hidden');
    elements.btnAnswerReplay.classList.add('hidden');
    
    let errText;
    if (err.message === 'APIKEY_MISSING') {
      errText = "请先在设置中配置您的 API Key 后重试。";
    } else {
      errText = "问诊失败：" + err.message;
    }
    elements.answerContentArea.innerText = errText;
    speakText("问诊出错，请查看屏幕上的错误详情。");
  }
}

// 4. 加载健康档案列表并渲染
async function renderRecordsList(filter = 'all') {
  const items = await getAllItems();
  elements.recordsList.innerHTML = "";
  
  const filtered = items.filter(item => {
    if (filter === 'all') return true;
    if (filter === 'notes') return item.type === 'note';
    if (filter === 'files') return item.type === 'file';
    return true;
  });
  
  if (filtered.length === 0) {
    elements.recordsList.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <p>目前还没有保存任何记录，点击上方按钮开始录入吧！</p>
      </div>
    `;
    return;
  }
  
  filtered.forEach(item => {
    const card = document.createElement('div');
    card.className = 'record-item-card';
    
    const dateStr = new Date(item.timestamp).toLocaleString('zh-CN', { 
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false 
    });
    
    if (item.type === 'note') {
      // 就医记录卡片
      const preview = item.content.length > 80 ? item.content.substring(0, 80) + '...' : item.content;
      card.innerHTML = `
        <div class="item-icon-box icon-box-note">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
          </svg>
        </div>
        <div class="item-main-content">
          <div class="item-meta">
            <span class="item-type-badge badge-note">口述就医记录</span>
            <span class="item-time">${dateStr}</span>
          </div>
          <div class="item-preview-text">${preview}</div>
        </div>
        <div class="item-actions">
          <button class="small-action-btn delete-btn" data-id="${Number(item.id)}" data-type="note" title="删除此记录">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      `;
    } else {
      // 文件记录卡片
      const summaryPreview = item.summary ? (item.summary.length > 60 ? item.summary.substring(0, 60) + '...' : item.summary) : '无摘要';
      const fileIcon = item.fileType?.startsWith('image/') ? '🖼️' : (item.fileType?.includes('pdf') ? '📄' : '📝');
      card.innerHTML = `
        <div class="item-icon-box icon-box-file">
          <span class="file-emoji" style="font-size: 1.5rem; display: flex; align-items: center; justify-content: center;">${fileIcon}</span>
        </div>
        <div class="item-main-content">
          <div class="item-meta">
            <span class="item-type-badge badge-file">${item.name}</span>
            <span class="item-time">${dateStr}</span>
          </div>
          <div class="item-detail-snippet">${summaryPreview}</div>
        </div>
        <div class="item-actions">
          <button class="small-action-btn delete-btn" data-id="${Number(item.id)}" data-type="file" title="删除此文件">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      `;
    }
    
    // 绑定删除按钮点击事件
    card.querySelector('.delete-btn').addEventListener('click', async (e) => {
      e.stopPropagation(); // 阻止事件冒泡到卡片点击
      e.preventDefault();
      
      // 直接从闭包中捕获 item 的 id 和 type（不再依赖 dataset）
      const deleteId = Number(item.id);
      const deleteType = item.type;
      console.log('[UI DELETE] 点击删除按钮, id=', deleteId, 'type=', deleteType);
      
      const confirmed = await showConfirm("确定要删除这条档案记录吗？此操作无法撤销。", "删除确认");
      console.log('[UI DELETE] 确认对话框结果:', confirmed);
      
      if (confirmed) {
        try {
          await deleteItemFromDB(deleteId, deleteType);
          speakText("删除成功");
          
          // 获取当前激活的分类 Tab 来刷新页面
          const activeTabBtn = document.querySelector('.tab-button.active');
          const currentFilter = activeTabBtn ? activeTabBtn.dataset.tab : 'all';
          renderRecordsList(currentFilter);
        } catch (err) {
          console.error("删除记录失败:", err);
          alert("删除失败，请重试。");
        }
      }
    });
    // 点击卡片事件
    card.addEventListener('click', (e) => {
      // 如果是删除按钮点击，不触发卡片事件
      if (e.target.closest('.delete-btn')) return;
      
      if (item.type === 'note') {
        // 口述笔记点击 -> 编辑模式
        elements.confirmRecordText.value = item.content;
        
        // 临时替换保存按钮为更新模式
        elements.btnConfirmSave.onclick = async () => {
          const updatedText = elements.confirmRecordText.value.trim();
          if (updatedText) {
            await deleteItemFromDB(Number(item.id), 'note');
            await saveNoteToDB(updatedText);
            hideModal(elements.modalRecordConfirm);
            renderRecordsList(filter);
            speakText("修改已保存");
          }
        };
        // 还原保存按钮原绑定事件的清理
        elements.btnCloseConfirm.addEventListener('click', () => { initSaveBtnEvent(); }, {once: true});
        elements.btnConfirmCancel.addEventListener('click', () => { initSaveBtnEvent(); }, {once: true});
        
        showModal(elements.modalRecordConfirm);
      } else {
        // 文档点击 -> 显示文档预览和 AI 解析摘要
        showDocDetail(item.id);
      }
    });
    
    elements.recordsList.appendChild(card);
  });
}

// 还原笔记保存的常规事件
function initSaveBtnEvent() {
  elements.btnConfirmSave.onclick = saveVoiceNote;
}

// 显示健康文件解析详情及预览
async function showDocDetail(id) {
  try {
    const doc = await getDocFromDB(id);
    if (!doc) return;
    
    elements.docTitleText.innerText = doc.name;
    elements.docTypeTag.innerText = doc.fileType.split('/')[1] || '文件';
    elements.docTimeText.innerText = new Date(doc.timestamp).toLocaleString('zh-CN');
    elements.docSummaryContent.innerText = doc.summary;
    
    // 加载文件预览
    elements.docPreviewContainer.innerHTML = "";
    if (doc.fileType.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = doc.fileData;
      img.className = 'preview-image';
      img.alt = doc.name;
      elements.docPreviewContainer.appendChild(img);
    } else {
      // PDF 或其他文档，显示标志
      elements.docPreviewContainer.innerHTML = `
        <div class="preview-file-placeholder">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <text x="7" y="16" fill="currentColor" font-size="6" font-weight="bold">${doc.fileType.includes('pdf') ? 'PDF' : 'DOC'}</text>
          </svg>
          <a href="${doc.fileData}" download="${doc.name}" class="secondary-button" style="padding: 0.5rem 1rem; font-size: 0.95rem; margin-top: 0.5rem;">下载原始文件</a>
        </div>
      `;
    }
    
    // 绑定详情弹窗中的删除事件
    elements.btnDocDelete.onclick = async () => {
      const confirmed = await showConfirm(`确定要彻底删除文件"${doc.name}"吗？`, '删除文件');
      if (confirmed) {
        await deleteItemFromDB(Number(doc.id), 'file');
        hideModal(elements.modalDocDetail);
        speakText("文件已删除");
        renderRecordsList();
      }
    };
    
    showModal(elements.modalDocDetail);
    
    // 朗读摘要内容
    speakText(doc.name + "的 AI 分析报告如下：" + doc.summary);
    
  } catch(e) {
    console.error("加载文档详情失败:", e);
    alert("加载文档失败。");
  }
}


// --- 交互界面动效控制与弹窗处理 ---

function showModal(modalEl) {
  modalEl.classList.remove('hidden');
}

function hideModal(modalEl) {
  modalEl.classList.add('hidden');
  stopSpeaking(); // 关闭弹窗时自动停止朗读，防打扰
}

function showGlobalLoading(title, desc) {
  elements.loadingMsgTitle.innerText = title;
  elements.loadingMsgDesc.innerText = desc;
  elements.globalLoading.classList.remove('hidden');
}

function hideGlobalLoading() {
  elements.globalLoading.classList.add('hidden');
}

// 导出备份数据
async function exportDatabase() {
  try {
    const items = await getAllItems();
    const records = items.filter(i => i.type === 'note');
    const documents = items.filter(i => i.type === 'file');
    
    const backupData = {
      records: records,
      documents: documents,
      exportTime: Date.now(),
      version: 1
    };
    
    const jsonStr = JSON.stringify(backupData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    a.href = url;
    a.download = `智能健康档案备份_${date}.json`;
    a.click();
    
    URL.revokeObjectURL(url);
    speakText("健康档案备份已成功导出。");
  } catch (err) {
    console.error("导出备份失败:", err);
    alert("备份导出失败，请重试。");
  }
}

function importDatabase(file) {
  if (!file) return Promise.resolve();
  console.log("[DEBUG] importDatabase: 开始导入，文件对象:", file.name);
  
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      console.log("[DEBUG] importDatabase: FileReader 读取成功");
      try {
        const data = JSON.parse(e.target.result);
        console.log("[DEBUG] importDatabase: JSON 解析成功, records 数量:", data?.records?.length, "docs 数量:", data?.documents?.length);
        
        if (!data || !Array.isArray(data.records) || !Array.isArray(data.documents)) {
          console.warn("[DEBUG] importDatabase: 格式校验失败");
          alert("导入失败：备份文件格式不正确。");
          resolve();
          return;
        }
        
        if (await showConfirm('确定要导入此备份文件吗？这会覆盖当前设备上的已有档案，且操作不可撤销！', '导入确认')) {
          showGlobalLoading("导入数据中", "正在恢复您的备份档案，请稍候...");
          
          console.log("[DEBUG] importDatabase: 创建单个原子大交易...");
          const tx = db.transaction(['records', 'documents'], 'readwrite');
          const store1 = tx.objectStore('records');
          const store2 = tx.objectStore('documents');
          
          console.log("[DEBUG] importDatabase: 清空现有数据排队...");
          store1.clear();
          store2.clear();
          
          console.log("[DEBUG] importDatabase: 开始循环写入 records...");
          for (const item of data.records) {
            delete item.id;
            store1.add(item);
          }
          
          console.log("[DEBUG] importDatabase: 开始循环写入 documents...");
          for (const item of data.documents) {
            delete item.id;
            store2.add(item);
          }
          
          console.log("[DEBUG] importDatabase: 开始等待交易完成...");
          tx.oncomplete = () => {
            console.log("[DEBUG] importDatabase: 导入事务成功完成");
            hideGlobalLoading();
            hideModal(elements.modalSettings);
            speakText("档案备份已成功导入。");
            renderRecordsList();
            resolve();
          };
          
          tx.onerror = (ev) => {
            console.error("[DEBUG] importDatabase: 写入交易出错:", ev.target.error || ev);
            hideGlobalLoading();
            alert("导入失败：写入数据库出错");
            reject(ev.target.error || new Error("写入数据库出错"));
          };
          
          tx.onabort = () => {
            console.warn("[DEBUG] importDatabase: 写入交易被中止");
            hideGlobalLoading();
            reject(new Error("事务被中止"));
          };
        } else {
          resolve();
        }
      } catch (err) {
        console.error("[DEBUG] importDatabase: 异常捕获:", err);
        hideGlobalLoading();
        alert(`导入失败：${err.message || "文件损坏或解析错误"}`);
        reject(err);
      }
    };
    
    reader.onerror = (err) => {
      console.error("[DEBUG] importDatabase: FileReader 读取出错:", err);
      alert("读取文件出错。");
      reject(err);
    };
    
    reader.readAsText(file);
  });
}


// --- 事件绑定集锦 ---
function bindEvents() {
  // 设置按钮
  elements.btnSettings.addEventListener('click', () => {
    initSettingsUI();
    showModal(elements.modalSettings);
  });
  elements.btnCloseSettings.addEventListener('click', () => hideModal(elements.modalSettings));
  
  // 保存配置（多模型版本）
  elements.btnSaveSettings.addEventListener('click', () => {
    const provider = elements.selectProvider.value;
    const apiUrl = elements.inputApiUrl.value.trim();
    const modelName = elements.inputModelName.value.trim();
    const key = elements.inputApiKey.value.trim();
    const rate = parseFloat(elements.selectVoiceRate.value);
    const size = elements.selectTextSize.value;
    
    SETTINGS.provider = provider;
    SETTINGS.apiUrl = apiUrl;
    SETTINGS.modelName = modelName;
    SETTINGS.apiKey = key;
    SETTINGS.voiceRate = rate;
    SETTINGS.textSize = size;
    
    localStorage.setItem('llm_provider', provider);
    localStorage.setItem('llm_api_url', apiUrl);
    localStorage.setItem('llm_model_name', modelName);
    localStorage.setItem('llm_api_key', key);
    localStorage.setItem('voice_rate', rate);
    applyTextSize(size);
    checkApiKeyStatus();
    
    hideModal(elements.modalSettings);
    speakText("设置保存成功。");
  });
  
  // 服务商选择变化时自动填充默认值
  elements.selectProvider.addEventListener('change', () => {
    const provider = elements.selectProvider.value;
    const defaults = PROVIDER_DEFAULTS[provider] || {};
    elements.inputApiUrl.value = defaults.url || '';
    elements.inputModelName.value = defaults.model || '';
  });
  
  elements.btnClearDb.addEventListener('click', async () => {
    // 先关闭设置弹窗，避免和确认弹窗层叠
    hideModal(elements.modalSettings);
    const confirmed = await showConfirm('【警告】这会清除本设备上保存的所有就医记录和健康文档！此操作不可逆，确定清空吗？', '清空所有数据');
    if (confirmed) {
      try {
        console.log('[CLEAR] 开始清空数据库...');
        await clearAllDBData();
        console.log('[CLEAR] 清空成功，刷新列表...');
        speakText("本地数据已全部清空。");
        renderRecordsList();
      } catch (err) {
        console.error("清空数据失败:", err);
        alert("清空数据失败，请重试。");
      }
    } else {
      // 用户取消，重新打开设置弹窗
      showModal(elements.modalSettings);
    }
  });

  // 语音录入大卡片
  elements.actionRecord.addEventListener('click', () => startVoiceRecognition(true));
  
  // 语音问诊大卡片
  elements.actionAsk.addEventListener('click', () => startVoiceRecognition(false));
  
  // 停止录音
  elements.btnSpeechStop.addEventListener('click', stopVoiceRecognition);
  elements.btnCloseSpeech.addEventListener('click', () => {
    if (speechRecognitionObj) speechRecognitionObj.stop();
    hideModal(elements.modalSpeech);
  });

  // 录入确认
  initSaveBtnEvent();
  elements.btnConfirmCancel.addEventListener('click', () => hideModal(elements.modalRecordConfirm));
  elements.btnCloseConfirm.addEventListener('click', () => hideModal(elements.modalRecordConfirm));

  // 回答弹窗
  elements.btnCloseAnswer.addEventListener('click', () => hideModal(elements.modalAnswer));
  elements.btnAnswerClose.addEventListener('click', () => hideModal(elements.modalAnswer));
  elements.btnAnswerReplay.addEventListener('click', () => {
    const responseText = elements.answerContentArea.innerText;
    if (responseText) {
      speakText(responseText);
    }
  });

  // 文档详情弹窗关闭
  elements.btnDocClose.addEventListener('click', () => hideModal(elements.modalDocDetail));
  elements.btnCloseDoc.addEventListener('click', () => hideModal(elements.modalDocDetail));

  // 上传文档触发
  elements.actionUpload.addEventListener('click', () => {
    elements.fileInput.click();
  });
  elements.fileInput.addEventListener('change', handleFileUpload);

  // 过滤 Tab 切换
  elements.tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      elements.tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderRecordsList(btn.dataset.tab);
    });
  });


  // 数据备份与同步按钮绑定
  elements.btnExportDb.addEventListener('click', exportDatabase);
  elements.btnImportDb.addEventListener('click', () => {
    elements.importDbInput.click();
  });
  elements.importDbInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    importDatabase(file);
    elements.importDbInput.value = '';
  });
}
