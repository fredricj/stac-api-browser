<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRegistryStore } from '@/stores/registryStore'
import { normaliseApiUrl, probeApi } from '@/stores/registryStore'
import type { ApiProbe, StacApiEntry } from '@/types/registry'

const emit = defineEmits<{ added: [entry: StacApiEntry] }>()

const { t } = useI18n()
const registry = useRegistryStore()

const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const urlInput = ref('')
const checking = ref(false)
const probe = ref<ApiProbe | null>(null)
const formError = ref('')

/** The normalised URL, or null while the input is not a usable http(s) URL. */
const normalised = computed(() => normaliseApiUrl(urlInput.value))

/** Adding is allowed after a check, even a failed one — see `addAnyway`. */
const canAdd = computed(() => probe.value !== null && normalised.value !== null)

/**
 * A failed probe or a catalog without item-search is a warning, not a block:
 * the catalog may simply be down, and the user knows their own network.
 */
const isWarning = computed(
  () =>
    probe.value?.state === 'unreachable' ||
    probe.value?.supportsItemSearch === false,
)

function open() {
  reset()
  const el = dialog.value
  if (!el) return
  // jsdom implements <dialog> only partially in some versions.
  if (typeof el.showModal === 'function') el.showModal()
  else el.setAttribute('open', '')
}

function close() {
  const el = dialog.value
  if (!el) return
  if (typeof el.close === 'function') el.close()
  else el.removeAttribute('open')
}

function reset() {
  urlInput.value = ''
  checking.value = false
  probe.value = null
  formError.value = ''
}

function duplicateOf(url: string): StacApiEntry | undefined {
  const target = normaliseApiUrl(url)
  return registry.entries.find((entry) => normaliseApiUrl(entry.url) === target)
}

async function check() {
  formError.value = ''
  probe.value = null

  const url = normalised.value
  if (!url) {
    formError.value = t('addDialog.invalidUrl')
    return
  }
  if (duplicateOf(url)) {
    formError.value = t('addDialog.duplicate')
    return
  }

  checking.value = true
  try {
    probe.value = await probeApi(url)
  } finally {
    checking.value = false
  }
}

function add() {
  const url = normalised.value
  if (!url || !probe.value) return

  const entry = registry.addCustomEntry({
    id: registry.nextIdFor(url),
    url,
    title: probe.value.title?.trim() || new URL(url).host,
    description: probe.value.description,
    auth: 'none',
  })

  emit('added', entry)
  close()
}

defineExpose({ open, close })
</script>

<template>
  <dialog ref="dialog" class="dialog" @close="reset">
    <form method="dialog" class="form" @submit.prevent="check">
      <h2 class="dialog-title">{{ t('addDialog.title') }}</h2>
      <p class="dialog-intro">{{ t('addDialog.intro') }}</p>

      <label class="field">
        <span class="field-label">{{ t('addDialog.urlLabel') }}</span>
        <input
          v-model="urlInput"
          type="url"
          class="field-input"
          :placeholder="t('addDialog.urlPlaceholder')"
          :aria-invalid="formError ? 'true' : undefined"
          autocomplete="url"
        />
      </label>

      <p v-if="formError" class="msg msg--error" role="alert">
        {{ formError }}
      </p>

      <!-- Probe outcome. Announced politely so screen readers pick it up
           without interrupting typing. -->
      <div v-if="probe" class="msg-group" role="status">
        <template v-if="probe.state === 'online'">
          <p class="msg msg--ok">
            {{ t('addDialog.foundTitle', { title: probe.title ?? '' }) }}
          </p>
          <p v-if="probe.supportsItemSearch" class="msg msg--ok">
            {{ t('addDialog.supportsSearch') }}
          </p>
          <p v-else class="msg msg--warn">{{ t('addDialog.noItemSearch') }}</p>
        </template>

        <template v-else-if="probe.state === 'unreachable'">
          <p class="msg msg--error">
            {{ t('addDialog.unreachable', { error: probe.error ?? '' }) }}
          </p>
          <p v-if="probe.likelyCors" class="msg msg--warn">
            {{ t('addDialog.corsExplainer') }}
          </p>
        </template>
      </div>

      <footer class="actions">
        <button type="button" class="btn" @click="close">
          {{ t('addDialog.cancel') }}
        </button>
        <button type="submit" class="btn" :disabled="checking">
          {{ checking ? t('addDialog.checking') : t('addDialog.check') }}
        </button>
        <button
          type="button"
          class="btn btn--primary"
          :disabled="!canAdd"
          @click="add"
        >
          {{ isWarning ? t('addDialog.addAnyway') : t('addDialog.add') }}
        </button>
      </footer>
    </form>
  </dialog>
</template>

<style scoped>
.dialog {
  width: min(34rem, calc(100vw - 2rem));
  padding: 0;
  border: 1px solid var(--c-border);
  border-radius: var(--r-lg);
  background: var(--c-surface);
  color: var(--c-text);
  box-shadow: var(--shadow-lg);
}

.dialog::backdrop {
  background: rgb(0 0 0 / 0.5);
}

.form {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  padding: var(--sp-5);
}

.dialog-title {
  font-size: var(--fs-xl);
}

.dialog-intro {
  color: var(--c-text-muted);
  font-size: var(--fs-sm);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.field-label {
  font-size: var(--fs-sm);
  font-weight: 500;
}

.field-input {
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--c-border-strong);
  border-radius: var(--r-md);
  background: var(--c-bg);
  font-size: var(--fs-sm);
}
.field-input[aria-invalid='true'] {
  border-color: var(--c-danger);
}

.msg-group {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.msg {
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-md);
  font-size: var(--fs-xs);
}
.msg--ok {
  background: var(--c-success-bg);
  color: var(--c-success);
}
.msg--warn {
  background: var(--c-warning-bg);
  color: var(--c-warning);
}
.msg--error {
  background: var(--c-danger-bg);
  color: var(--c-danger);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--sp-2);
  margin-top: var(--sp-2);
}

.btn {
  padding: var(--sp-2) var(--sp-4);
  border: 1px solid var(--c-border-strong);
  border-radius: var(--r-md);
  background: var(--c-surface);
  font-size: var(--fs-sm);
  cursor: pointer;
  transition:
    background var(--transition),
    border-color var(--transition);
}
.btn:hover:not(:disabled) {
  background: var(--c-surface-hover);
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn--primary {
  background: var(--c-accent);
  border-color: var(--c-accent);
  color: var(--c-text-inverse);
}
.btn--primary:hover:not(:disabled) {
  background: var(--c-accent-hover);
  border-color: var(--c-accent-hover);
}
</style>
