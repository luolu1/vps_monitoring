function setStatus(text) {
  const status = document.getElementById("status");
  status.textContent = text;
}

function getValue(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : "";
}

function saveForm(data) {
  chrome.storage.local.set({ popupForm: data });
}

function loadForm() {
  chrome.storage.local.get(["popupForm"], (result) => {
    const data = result.popupForm || {};
    if (data.email) document.getElementById("email").value = data.email;
    if (data.password) document.getElementById("password").value = data.password;
    if (data.twoFactorCode) document.getElementById("twoFactorCode").value = data.twoFactorCode;
  });
}

function bindStart() {
  const button = document.getElementById("startBtn");
  button.addEventListener("click", () => {
    const payload = {
      email: getValue("email"),
      password: getValue("password"),
      twoFactorCode: getValue("twoFactorCode")
    };

    if (!payload.email || !payload.password) {
      setStatus("请填写邮箱和密码");
      return;
    }

    saveForm(payload);
    button.disabled = true;
    setStatus("正在打开无痕窗口...");

    chrome.runtime.sendMessage({ type: "startLogin", ...payload }, (response) => {
      button.disabled = false;
      if (chrome.runtime.lastError) {
        setStatus(`失败：${chrome.runtime.lastError.message}`);
        return;
      }
      if (!response || !response.ok) {
        setStatus(`失败：${response?.error || "未知错误"}`);
        return;
      }
      setStatus("已启动，请在无痕窗口观察自动登录过程");
    });
  });
}

loadForm();
bindStart();
