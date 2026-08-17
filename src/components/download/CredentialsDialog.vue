<script setup lang="ts">
/**
 * Where the user hands over real Geotorget credentials.
 *
 * Two obligations shape this dialog. It must **say what happens to the
 * password** — that it goes straight from this browser to the asset host and
 * through no server of ours, because there is no server of ours — and it must
 * **tell 401 from 403**. Geotorget grants access per product, so a valid
 * account with no orthophoto subscription gets 403; reporting that as "wrong
 * password" sends someone to reset a password that was never the problem.
 *
 * Nothing here logs, and the password is never put in the DOM as a value the
 * page can be scraped for beyond the input itself.
 */
import { computed, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/authStore'
import { checkCredentials, type AuthCheckStatus } from '@/services/auth'

const props = defineProps<{
  /** Asset host these credentials are scoped to, e.g. `dl1.lantmateriet.se`. */
  host: string
  /**
   * A real asset to test against. Null when nothing is selected yet, in which
   * case credentials can be saved but not verified.
   */
  sampleAssetUrl: string | null
  /** Where to request access, shown when the answer is 403. */
  docsUrl?: string
}>()

const emit = defineEmits<{ saved: [] }>()

const { t } = useI18n()
const auth = useAuthStore()

const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const username = ref('')
const password = ref('')
const remember = ref(false)
const checking = ref(false)
const result = ref<AuthCheckStatus | null>(null)

const canSubmit = computed(
  () => username.value.trim().length > 0 && password.value.length > 0,
)

const canVerify = computed(
  () => canSubmit.value && props.sampleAssetUrl !== null,
)

/** Only a successful check should look like success. */
const verified = computed(() => result.value === 'ok')

function open() {
  reset()
  // Prefill the username so re-entering a password is not a memory test; the
  // password itself is never read back out of the store into the field.
  username.value = auth.usernameFor(props.host) ?? ''
  remember.value = auth.scopeFor(props.host) === 'session'

  const element = dialog.value
  if (!element) return
  if (typeof element.showModal === 'function') element.showModal()
  else element.setAttribute('open', '')
}

function close() {
  const element = dialog.value
  if (!element) return
  if (typeof element.close === 'function') element.close()
  else element.removeAttribute('open')
}

function reset() {
  username.value = ''
  password.value = ''
  remember.value = false
  checking.value = false
  result.value = null
}

/** Any edit invalidates a previous verdict. */
watch([username, password], () => {
  result.value = null
})

async function verify() {
  const assetUrl = props.sampleAssetUrl
  if (!assetUrl || !canSubmit.value) return

  checking.value = true
  try {
    const outcome = await checkCredentials(assetUrl, {
      username: username.value.trim(),
      password: password.value,
    })
    result.value = outcome.status
  } finally {
    checking.value = false
  }
}

function save() {
  if (!canSubmit.value) return
  auth.set(
    props.host,
    { username: username.value.trim(), password: password.value },
    remember.value ? 'session' : 'memory',
  )
  emit('saved')
  close()
}

defineExpose({ open, close })
</script>

<template>
  <dialog ref="dialog" class="dialog" @close="reset">
    <form class="form" @submit.prevent="verify">
      <h2 class="title">{{ t('auth.title') }}</h2>

      <!-- The disclosure. Stated before the fields, not buried under them. -->
      <p class="disclosure">{{ t('auth.disclosure', { host }) }}</p>
      <p class="disclosure disclosure--muted">{{ t('auth.noServer') }}</p>

      <label class="field">
        <span class="field-label">{{ t('auth.username') }}</span>
        <input
          v-model="username"
          type="text"
          class="field-input"
          autocomplete="username"
          spellcheck="false"
          autocapitalize="none"
        />
      </label>

      <label class="field">
        <span class="field-label">{{ t('auth.password') }}</span>
        <input
          v-model="password"
          type="password"
          class="field-input"
          autocomplete="current-password"
        />
      </label>

      <label class="remember">
        <input v-model="remember" type="checkbox" />
        <span>
          {{ t('auth.remember') }}
          <span class="remember-hint">{{ t('auth.rememberHint') }}</span>
        </span>
      </label>

      <!-- Announced politely so a screen reader hears the verdict without
           being interrupted mid-field. -->
      <div class="verdict" role="status" aria-live="polite">
        <p v-if="!sampleAssetUrl" class="msg msg--warn">
          {{ t('auth.nothingToVerify') }}
        </p>

        <template v-else-if="result === 'ok'">
          <p class="msg msg--ok">{{ t('auth.ok') }}</p>
        </template>

        <template v-else-if="result === 'invalid'">
          <p class="msg msg--error">{{ t('auth.invalid') }}</p>
        </template>

        <!-- The distinction that matters: the password is fine, the
             subscription is missing. -->
        <template v-else-if="result === 'forbidden'">
          <p class="msg msg--warn">{{ t('auth.forbidden') }}</p>
          <p v-if="docsUrl" class="msg-link">
            <a :href="docsUrl" target="_blank" rel="noopener noreferrer">
              {{ t('auth.forbiddenLink') }}
            </a>
          </p>
        </template>

        <p v-else-if="result === 'missing'" class="msg msg--warn">
          {{ t('auth.missing') }}
        </p>
        <p v-else-if="result === 'unreachable'" class="msg msg--error">
          {{ t('auth.unreachable') }}
        </p>
        <p v-else-if="result === 'unexpected'" class="msg msg--error">
          {{ t('auth.unexpected') }}
        </p>
      </div>

      <footer class="actions">
        <button type="button" class="btn" @click="close">
          {{ t('common.cancel') }}
        </button>
        <button type="submit" class="btn" :disabled="!canVerify || checking">
          {{ checking ? t('auth.checking') : t('auth.check') }}
        </button>
        <button
          type="button"
          class="btn btn--primary"
          :disabled="!canSubmit"
          @click="save"
        >
          {{ verified ? t('auth.save') : t('auth.saveUnverified') }}
        </button>
      </footer>
    </form>
  </dialog>
</template>

<style scoped>
.dialog {
  width: min(32rem, calc(100vw - 2rem));
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

.title {
  font-size: var(--fs-xl);
}

.disclosure {
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}

.disclosure--muted {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
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

.remember {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-2);
  font-size: var(--fs-sm);
  cursor: pointer;
}

.remember-hint {
  display: block;
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}

.verdict:empty {
  display: none;
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

.msg-link {
  margin-top: var(--sp-1);
  font-size: var(--fs-xs);
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
