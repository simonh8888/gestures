// gestureUI.js - Phase 3 recording UI (manage gestures panel)
//
// Depends on GestureStore, GestureRecorder. Calls window.refreshGestures after
// mutations so the live matcher reloads templates.

(function () {
  "use strict";

  const DEFAULT_THRESHOLD = 1.7;

  const els = {};
  let actions = [];
  let gestures = [];
  let editingName = null; // null = new gesture; string = editing existing

  function actionLabel(action) {
    return action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function setFormMessage(text, isError) {
    els.formMessage.textContent = text || "";
    els.formMessage.className = isError ? "form-message error" : "form-message";
  }

  function setRecordingUI(active) {
    els.nameInput.disabled = active;
    els.actionSelect.disabled = active;
    els.recordBtn.disabled = active;
    els.cancelRecordBtn.hidden = !active;
    els.saveActionBtn.disabled = active;
    els.renameBtn.disabled = active;
    els.reRecordBtn.disabled = active;
    els.editCancelBtn.disabled = active;
    listButtonsDisabled(active);
  }

  function listButtonsDisabled(disabled) {
    els.gestureList.querySelectorAll("button").forEach((b) => {
      b.disabled = disabled;
    });
  }

  function showCountdown(n) {
    els.countdownOverlay.hidden = false;
    els.countdownOverlay.textContent = String(n);
  }

  function hideCountdown() {
    els.countdownOverlay.hidden = true;
  }

  function resetNewForm() {
    editingName = null;
    els.nameInput.value = "";
    els.nameInput.disabled = false;
    els.actionSelect.disabled = false;
    els.saveActionBtn.hidden = true;
    els.renameBtn.hidden = true;
    els.reRecordBtn.hidden = true;
    els.editCancelBtn.hidden = true;
    els.recordBtn.hidden = false;
    els.recordBtn.textContent = "Record";
    setFormMessage("");
  }

  function enterEditMode(gesture) {
    editingName = gesture.name;
    els.nameInput.value = gesture.name;
    els.nameInput.disabled = false;
    els.actionSelect.value = gesture.action;
    els.recordBtn.hidden = true;
    els.saveActionBtn.hidden = false;
    els.renameBtn.hidden = false;
    els.reRecordBtn.hidden = false;
    els.editCancelBtn.hidden = false;
    setFormMessage(`Editing "${gesture.name}"`);
  }

  function validateRename(newName) {
    const trimmed = newName.trim();
    if (!trimmed) return { ok: false, error: "Enter a gesture name." };
    if (trimmed === editingName) return { ok: false, error: "Name unchanged." };
    if (gestures.some((g) => g.name === trimmed)) {
      return { ok: false, error: `Gesture "${trimmed}" already exists.` };
    }
    return { ok: true, name: trimmed };
  }

  function validateNewName(name) {
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, error: "Enter a gesture name." };
    if (gestures.some((g) => g.name === trimmed)) {
      return { ok: false, error: `Gesture "${trimmed}" already exists.` };
    }
    return { ok: true, name: trimmed };
  }

  function landmarksToPoints(raw) {
    return raw.map((p) => ({ x: p[0], y: p[1], z: p[2] || 0 }));
  }

  async function buildGestureDoc(capture, name, action, excludeName) {
    const points = landmarksToPoints(capture.landmarks);
    const norm = Matcher.normalizeLandmarks(points, capture.handedness);
    const { templates } = await GestureStore.loadGestures();
    const threshold = norm
      ? Matcher.computeAutoThreshold(Array.from(norm), templates, excludeName)
      : DEFAULT_THRESHOLD;
    return {
      name,
      type: "static",
      action,
      landmarks: capture.landmarks,
      frames: null,
      handedness: capture.handedness,
      threshold,
    };
  }

  async function afterMutation(message) {
    await window.refreshGestures();
    setFormMessage(message, false);
    renderList();
  }

  async function saveNewGesture(capture) {
    const nameCheck = validateNewName(els.nameInput.value);
    if (!nameCheck.ok) {
      setFormMessage(nameCheck.error, true);
      return;
    }
    const action = els.actionSelect.value;
    try {
      const doc = await buildGestureDoc(capture, nameCheck.name, action, null);
      await GestureStore.createGesture(doc);
      window.startGestureCooldown?.();
      resetNewForm();
      await afterMutation(`Saved "${nameCheck.name}".`);
    } catch (err) {
      setFormMessage(err.message, true);
    }
  }

  async function saveExistingCapture(capture) {
    if (!editingName) return;
    const action = els.actionSelect.value;
    try {
      const doc = await buildGestureDoc(capture, editingName, action, editingName);
      await GestureStore.updateGesture(editingName, doc);
      window.startGestureCooldown?.();
      await afterMutation(`Re-recorded "${editingName}".`);
    } catch (err) {
      setFormMessage(err.message, true);
    }
  }

  async function saveRename() {
    if (!editingName) return;
    const nameCheck = validateRename(els.nameInput.value);
    if (!nameCheck.ok) {
      setFormMessage(nameCheck.error, true);
      return;
    }
    const existing = gestures.find((g) => g.name === editingName);
    if (!existing) return;
    const oldName = editingName;
    try {
      await GestureStore.updateGesture(oldName, {
        name: nameCheck.name,
        type: existing.type || "static",
        action: existing.action,
        landmarks: existing.landmarks,
        frames: existing.frames ?? null,
        handedness: existing.handedness,
        threshold: existing.threshold ?? DEFAULT_THRESHOLD,
      });
      editingName = nameCheck.name;
      await afterMutation(`Renamed "${oldName}" to "${nameCheck.name}".`);
    } catch (err) {
      setFormMessage(err.message, true);
    }
  }

  async function saveActionOnly() {
    if (!editingName) return;
    const action = els.actionSelect.value;
    const existing = gestures.find((g) => g.name === editingName);
    if (!existing) return;
    try {
      await GestureStore.updateGesture(editingName, {
        name: editingName,
        type: existing.type || "static",
        action,
        landmarks: existing.landmarks,
        frames: existing.frames ?? null,
        handedness: existing.handedness,
        threshold: existing.threshold ?? DEFAULT_THRESHOLD,
      });
      await afterMutation(`Updated action for "${editingName}".`);
    } catch (err) {
      setFormMessage(err.message, true);
    }
  }

  function startRecording(forExisting) {
    if (!window.isCameraReady?.()) {
      setFormMessage("Activate the camera before recording.", true);
      return;
    }
    if (!forExisting) {
      const nameCheck = validateNewName(els.nameInput.value);
      if (!nameCheck.ok) {
        setFormMessage(nameCheck.error, true);
        return;
      }
    } else if (!editingName) {
      return;
    }

    setRecordingUI(true);
    setFormMessage(forExisting ? "Get ready to re-record…" : "Get ready to record…");

    GestureRecorder.startCountdown({
      onTick: (n) => {
        showCountdown(n);
        setFormMessage(n > 0 ? `Hold pose in ${n}…` : "Hold pose!");
      },
      onCaptureStart: () => {
        showCountdown("●");
        setFormMessage("Capturing… hold still");
      },
      onComplete: async (capture) => {
        hideCountdown();
        setRecordingUI(false);
        if (forExisting) await saveExistingCapture(capture);
        else await saveNewGesture(capture);
      },
      onError: (msg) => {
        hideCountdown();
        setRecordingUI(false);
        setFormMessage(msg, true);
      },
    });
  }

  function renderList() {
    els.gestureList.innerHTML = "";
    if (gestures.length === 0) {
      els.gestureList.innerHTML = '<li class="empty">No saved gestures yet.</li>';
      return;
    }
    for (const g of gestures) {
      const li = document.createElement("li");
      li.className = "gesture-item";
      li.innerHTML = `
        <span class="gesture-label">${escapeHtml(g.name)}: ${escapeHtml(actionLabel(g.action))}</span>
        <span class="gesture-actions">
          <button type="button" class="btn-edit" data-name="${escapeAttr(g.name)}">Edit</button>
          <button type="button" class="btn-rerecord" data-name="${escapeAttr(g.name)}">Re-record</button>
          <button type="button" class="btn-delete" data-name="${escapeAttr(g.name)}">Delete</button>
        </span>`;
      els.gestureList.appendChild(li);
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, "&#39;");
  }

  async function loadActions() {
    try {
      actions = await GestureStore.fetchActions();
    } catch (err) {
      actions = [
        "scroll_up", "scroll_down", "new_tab", "close_tab", "next_tab", "prev_tab",
        "back", "forward", "refresh", "zoom_in", "zoom_out",
      ];
      console.warn("Could not load actions from server:", err.message);
    }
    els.actionSelect.innerHTML = actions
      .map((a) => `<option value="${escapeAttr(a)}">${escapeHtml(actionLabel(a))}</option>`)
      .join("");
  }

  async function refreshList() {
    const { gestures: docs, error } = await GestureStore.listGestures();
    gestures = docs;
    renderList();
    if (error) setFormMessage(`Server unreachable — showing cache. (${error})`, true);
  }

  function bindEvents() {
    els.recordBtn.addEventListener("click", () => startRecording(false));

    els.reRecordBtn.addEventListener("click", () => startRecording(true));

    els.cancelRecordBtn.addEventListener("click", () => {
      GestureRecorder.cancel();
      hideCountdown();
      setRecordingUI(false);
      setFormMessage("Recording cancelled.");
    });

    els.saveActionBtn.addEventListener("click", () => saveActionOnly());

    els.renameBtn.addEventListener("click", () => saveRename());

    els.editCancelBtn.addEventListener("click", () => resetNewForm());

    els.gestureList.addEventListener("click", async (e) => {
      const btn = e.target.closest("button");
      if (!btn || GestureRecorder.isActive()) return;
      const name = btn.dataset.name;
      if (!name) return;

      if (btn.classList.contains("btn-edit")) {
        const g = gestures.find((x) => x.name === name);
        if (g) enterEditMode(g);
        return;
      }

      if (btn.classList.contains("btn-rerecord")) {
        const g = gestures.find((x) => x.name === name);
        if (g) {
          enterEditMode(g);
          startRecording(true);
        }
        return;
      }

      if (btn.classList.contains("btn-delete")) {
        if (!confirm(`Delete gesture "${name}"?`)) return;
        try {
          await GestureStore.deleteGesture(name);
          if (editingName === name) resetNewForm();
          await afterMutation(`Deleted "${name}".`);
        } catch (err) {
          setFormMessage(err.message, true);
        }
      }
    });
  }

  function cacheElements() {
    els.nameInput = document.getElementById("gestureName");
    els.actionSelect = document.getElementById("gestureAction");
    els.recordBtn = document.getElementById("recordGesture");
    els.cancelRecordBtn = document.getElementById("cancelRecord");
    els.saveActionBtn = document.getElementById("saveAction");
    els.renameBtn = document.getElementById("renameGesture");
    els.reRecordBtn = document.getElementById("reRecordGesture");
    els.editCancelBtn = document.getElementById("cancelEdit");
    els.formMessage = document.getElementById("formMessage");
    els.gestureList = document.getElementById("gestureList");
    els.countdownOverlay = document.getElementById("countdownOverlay");
  }

  async function init() {
    cacheElements();
    bindEvents();
    await loadActions();
    await refreshList();
  }

  window.GestureUI = { init, refreshList };
})();
