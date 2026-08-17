<script setup lang="ts">
/**
 * Choosing how to fetch a selection.
 */
import { computed, ref, shallowRef, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSelectionStore } from '@/stores/selectionStore'
import { useAuthStore } from '@/stores/authStore'
import { assetHostOf } from '@/services/auth'
import {
  ensureWritePermission,
  isDirectoryPickerSupported,
  pickDirectory,
  safeFilename,
} from '@/services/fsAccess'
import {
  createDownloadQueue,
  downloadViaBlob,
  type DownloadQueue,
  type QueueSnapshot,
} from '@/services/downloader'
import {
  loadPreferredTier,
  resolveInitialTier,
  savePreferredTier,
  type DownloadTier,
} from '@/services/downloadPreference'
import { formatBytes } from '@/utils/format'
import type { StacApiEntry } from '@/types/registry'
import CredentialsDialog from '@/components/download/CredentialsDialog.vue'
import DownloadProgressPanel from '@/components/download/DownloadProgressPanel.vue'
import ManifestExportPanel from '@/components/download/ManifestExportPanel.vue'

/** One file at a time, either sub-way. */
type SequentialMode = 'auto' | 'links'

/**
 * Above this, a browser is the wrong tool and the dialog recommends aria2c.
 * Chosen to be roughly "more than an afternoon": ~20 tiles of this catalog.
 */
const MANIFEST_THRESHOLD_BYTES = 20e9

const props = defineProps<{
  /** For the auth type and the Geotorget product link a 403 points to. */
  entry: StacApiEntry | null
}>()

const { t, locale } = useI18n()
const selection = useSelectionStore()
const auth = useAuthStore()

const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const credentialsDialog =
  useTemplateRef<InstanceType<typeof CredentialsDialog>>('credentialsDialog')

const canStreamToFolder = isDirectoryPickerSupported()

const snapshot = ref<QueueSnapshot | null>(null)
const queue = shallowRef<DownloadQueue | null>(null)
const busy = ref(false)
const problem = ref<string | null>(null)

/**
 * *Save one at a time* splits further: fetch each file through the app, or
 * just list the raw links and let the browser's own Basic-auth prompt handle
 * the sign-in. Defaults to the former — the existing behaviour — because it
 * is the one that actually saves the file without extra clicks.
 */
const sequentialMode = ref<SequentialMode>('auto')

const size = computed(() => selection.size)
const sizeLabel = computed(() => formatBytes(size.value.bytes, locale.value))

/** The plan's tier-3 recommendation, stated before any work begins. */
const oversized = computed(() => size.value.bytes > MANIFEST_THRESHOLD_BYTES)

/** Declared after `oversized`, so the opening choice can actually consult it. */
const tier = ref<DownloadTier>(
  resolveInitialTier({
    remembered: loadPreferredTier(),
    canStreamToFolder,
    oversized: oversized.value,
  }),
)

/**
 * Remember only a deliberate choice.
 *
 * Bound to `change` rather than watching `tier`, because `open()` also writes
 * it — persisting that would turn a computed default into a "preference" and
 * quietly disable the size-based steering from then on.
 */
function rememberTier() {
  savePreferredTier(tier.value)
}

const assetHost = computed(() => {
  const href = selection.items.find((item) => item.href)?.href
  return href ? assetHostOf(href) : null
})

const credentials = computed(() => auth.get(assetHost.value))
const downloadable = computed(() => selection.items.filter((item) => item.href))
const sampleAssetUrl = computed(() => downloadable.value[0]?.href ?? null)

/* ---------------- Credentials ---------------- */

/** True when this catalog's assets are behind a sign-in. */
const needsAuth = computed(() => props.entry?.auth === 'basic')

/**
 * Only *save to a folder* and *save one at a time, automatically* fetch
 * anything through this app — a download manager reads the manifest's own
 * `${STAC_USER}`/`${STAC_PASSWORD}` placeholders from the shell environment
 * it runs in, and the *links* sub-mode hands the sign-in to the browser's own
 * prompt. Asking for credentials the chosen route will never use is exactly
 * the confusion this gates against.
 */
const needsCredentials = computed(
  () =>
    needsAuth.value &&
    assetHost.value !== null &&
    (tier.value === 'folder' ||
      (tier.value === 'sequential' && sequentialMode.value === 'auto')),
)

const signedInAs = computed(() => auth.usernameFor(assetHost.value))
const rememberedCredentials = computed(
  () => auth.scopeFor(assetHost.value) === 'session',
)

function signOut() {
  if (assetHost.value) auth.clear(assetHost.value)
}

function open() {
  problem.value = null
  snapshot.value = null
  queue.value = null
  busy.value = false
  sequentialMode.value = 'auto'
  tier.value = resolveInitialTier({
    remembered: loadPreferredTier(),
    canStreamToFolder,
    oversized: oversized.value,
  })

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

/** Tier 1: pick a folder, then stream every file into it. */
async function startFolderDownload() {
  problem.value = null

  const directory = await pickDirectory()
  // Cancelling the picker is an ordinary choice, not an error.
  if (!directory) return

  if (!(await ensureWritePermission(directory))) {
    problem.value = t('download.permissionDenied')
    return
  }

  busy.value = true
  const created = createDownloadQueue({
    sources: downloadable.value.map((item) => ({
      key: item.key,
      url: item.href!,
      expectedSize: item.size,
    })),
    directory,
    credentials: credentials.value,
    onChange: (next) => {
      snapshot.value = next
    },
  })

  queue.value = created
  snapshot.value = created.snapshot()
  await created.start()
  busy.value = false
}

/**
 * Tier 2: one file at a time, through memory.
 *
 * Firefox and Safari have no directory handle, so each file is buffered whole
 * and handed to the browser's own downloader. The tab must stay open.
 */
async function startSequentialDownload() {
  problem.value = null
  busy.value = true

  try {
    for (const item of downloadable.value) {
      await downloadViaBlob(
        item.href!,
        safeFilename(item.href!, item.id),
        credentials.value,
      )
    }
  } catch {
    problem.value = t('download.sequentialFailed')
  } finally {
    busy.value = false
  }
}

defineExpose({ open, close })
</script>

<template>
  <dialog ref="dialog" class="dialog">
    <div class="body">
      <header class="head">
        <h2 class="title">{{ t('download.title') }}</h2>
        <button
          type="button"
          class="close"
          :aria-label="t('common.close')"
          @click="close"
        >
          &times;
        </button>
      </header>

      <p class="summary">
        {{
          t('download.summary', {
            count: downloadable.length,
            size: sizeLabel,
          })
        }}
        <span v-if="size.estimated" class="estimated">
          {{ t('download.sizeEstimated') }}
        </span>
      </p>

      <!-- Said before any tier is chosen, not after an hour of waiting. -->
      <p v-if="oversized" class="recommend">
        {{ t('download.tooBigForBrowser', { size: sizeLabel }) }}
      </p>

      <!-- Progress replaces the chooser once a run is under way. -->
      <template v-if="snapshot">
        <DownloadProgressPanel
          :snapshot="snapshot"
          @pause="queue?.pause()"
          @resume="queue?.resume()"
          @cancel="queue?.cancel()"
          @retry-failed="queue?.retryFailed()"
        />
      </template>

      <template v-else>
        <fieldset class="tiers">
          <legend class="sr-only">{{ t('download.tierLegend') }}</legend>

          <label class="tier" :class="{ 'is-off': !canStreamToFolder }">
            <input
              v-model="tier"
              type="radio"
              value="folder"
              :disabled="!canStreamToFolder"
              @change="rememberTier"
            />
            <span class="tier-text">
              <span class="tier-name">{{
                t('download.tier.folder.name')
              }}</span>
              <span class="tier-hint">
                {{
                  canStreamToFolder
                    ? t('download.tier.folder.hint')
                    : t('download.tier.folder.unsupported')
                }}
              </span>
            </span>
          </label>

          <label class="tier">
            <input
              v-model="tier"
              type="radio"
              value="sequential"
              @change="rememberTier"
            />
            <span class="tier-text">
              <span class="tier-name">
                {{ t('download.tier.sequential.name') }}
              </span>
              <span class="tier-hint">
                {{ t('download.tier.sequential.hint') }}
              </span>
            </span>
          </label>

          <!-- Nested inside the option it belongs to, not tacked on after
               every tier — the sub-choice only makes sense once "save one at
               a time" is the thing selected. -->
          <template v-if="tier === 'sequential'">
            <fieldset class="modes">
              <legend class="sr-only">
                {{ t('download.sequential.modeLegend') }}
              </legend>

              <label class="mode">
                <input v-model="sequentialMode" type="radio" value="auto" />
                <span class="mode-text">
                  <span class="mode-name">
                    {{ t('download.sequential.auto.name') }}
                  </span>
                  <span class="mode-hint">
                    {{ t('download.sequential.auto.hint') }}
                  </span>
                </span>
              </label>

              <label class="mode">
                <input v-model="sequentialMode" type="radio" value="links" />
                <span class="mode-text">
                  <span class="mode-name">
                    {{ t('download.sequential.links.name') }}
                  </span>
                  <span class="mode-hint">
                    {{ t('download.sequential.links.hint') }}
                  </span>
                </span>
              </label>
            </fieldset>

            <p v-if="sequentialMode === 'auto'" class="warn indented">
              {{ t('download.sequentialWarning') }}
            </p>

            <!-- No fetch of ours touches these — the browser navigates to the
                 asset directly, so its own Basic-auth prompt is what asks for
                 the password, and the app never sees it. -->
            <ul
              v-else
              class="link-list"
              :aria-label="t('download.sequential.links.name')"
            >
              <li v-for="item in downloadable" :key="item.key">
                <a :href="item.href!" target="_blank" rel="noopener noreferrer">
                  {{ safeFilename(item.href!, item.id) }}
                </a>
              </li>
            </ul>
          </template>

          <label class="tier">
            <input
              v-model="tier"
              type="radio"
              value="manifest"
              @change="rememberTier"
            />
            <span class="tier-text">
              <span class="tier-name">
                {{ t('download.tier.manifest.name') }}
              </span>
              <span class="tier-hint">
                {{ t('download.tier.manifest.hint') }}
              </span>
            </span>
          </label>

          <!-- Same reasoning: the export panel belongs under the option that
               reveals it. -->
          <ManifestExportPanel v-if="tier === 'manifest'" class="indented" />
        </fieldset>

        <!-- Sign-in lives here, scoped to the tier that is actually chosen:
             a download manager reads credentials from the shell environment
             it runs in, and the *links* sub-mode hands the prompt to the
             browser itself, so asking for a password neither route will use
             would only confuse. -->
        <div v-if="needsCredentials" class="auth">
          <template v-if="signedInAs">
            <p class="auth-state">
              <span class="auth-ok">
                {{ t('auth.signedInAs', { username: signedInAs }) }}
              </span>
              <span class="auth-scope">
                {{
                  rememberedCredentials
                    ? t('auth.scopeSession')
                    : t('auth.scopeMemory')
                }}
              </span>
            </p>
            <div class="auth-actions">
              <button
                type="button"
                class="link"
                @click="credentialsDialog?.open()"
              >
                {{ t('auth.change') }}
              </button>
              <button type="button" class="link link--danger" @click="signOut">
                {{ t('auth.signOut') }}
              </button>
            </div>
          </template>

          <template v-else>
            <p class="auth-state">
              {{ t('auth.needed', { host: assetHost }) }}
            </p>
            <button
              type="button"
              class="link"
              @click="credentialsDialog?.open()"
            >
              {{ t('auth.signIn') }}
            </button>
          </template>
        </div>
        <CredentialsDialog
          v-if="needsAuth && assetHost"
          ref="credentialsDialog"
          :host="assetHost"
          :sample-asset-url="sampleAssetUrl"
          :docs-url="entry?.docsUrl"
        />
      </template>

      <p v-if="problem" class="error" role="alert">{{ problem }}</p>

      <footer class="actions">
        <button type="button" class="btn" @click="close">
          {{ t('common.close') }}
        </button>

        <button
          v-if="!snapshot && tier === 'folder'"
          type="button"
          class="btn btn--primary"
          :disabled="busy || downloadable.length === 0"
          @click="startFolderDownload"
        >
          {{ t('download.chooseFolder') }}
        </button>

        <button
          v-if="!snapshot && tier === 'sequential' && sequentialMode === 'auto'"
          type="button"
          class="btn btn--primary"
          :disabled="busy || downloadable.length === 0"
          @click="startSequentialDownload"
        >
          {{ busy ? t('download.running') : t('download.startSequential') }}
        </button>
      </footer>
    </div>
  </dialog>
</template>

<style scoped>
.dialog {
  width: min(42rem, calc(100vw - 2rem));
  max-height: calc(100dvh - 4rem);
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

.body {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  padding: var(--sp-5);
  max-height: calc(100dvh - 4rem);
  overflow-y: auto;
}

.head {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-2);
}

.title {
  font-size: var(--fs-xl);
  margin-right: auto;
}

.close {
  border: 0;
  background: none;
  font-size: var(--fs-2xl);
  line-height: 1;
  color: var(--c-text-muted);
  cursor: pointer;
  padding: 0 var(--sp-1);
}
.close:hover {
  color: var(--c-text);
}

.summary {
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}

.estimated {
  color: var(--c-warning);
}

.recommend,
.warn {
  font-size: var(--fs-xs);
  color: var(--c-warning);
  background: var(--c-warning-bg);
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-md);
}

.error {
  font-size: var(--fs-xs);
  color: var(--c-danger);
  background: var(--c-danger-bg);
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-md);
}

.tiers {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  border: 0;
  padding: 0;
  margin: 0;
}

.tier {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  cursor: pointer;
}
.tier:hover {
  background: var(--c-surface-hover);
}
.tier.is-off {
  opacity: 0.6;
  cursor: not-allowed;
}

.tier-text {
  display: flex;
  flex-direction: column;
}

.tier-name {
  font-size: var(--fs-sm);
  font-weight: 600;
}

.tier-hint {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}

/* Ties a tier's revealed content back to the option above it, visually. */
.indented {
  margin-left: var(--sp-4);
}

.modes {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  border: 0;
  padding: var(--sp-1) 0 var(--sp-1) var(--sp-4);
  margin: 0;
}

.mode {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  cursor: pointer;
}
.mode:hover {
  background: var(--c-surface-hover);
}

.mode-text {
  display: flex;
  flex-direction: column;
}

.mode-name {
  font-size: var(--fs-sm);
  font-weight: 600;
}

.mode-hint {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}

.link-list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  margin: 0 0 0 var(--sp-4);
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-surface-2);
  max-height: 14rem;
  overflow-y: auto;
  list-style: none;
}

.link-list a {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  overflow-wrap: anywhere;
}

.auth {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  padding-top: var(--sp-2);
  border-top: 1px solid var(--c-border);
}

.auth-state {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--sp-2);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}

.auth-ok {
  color: var(--c-success);
  font-weight: 600;
}

.auth-scope {
  color: var(--c-text-faint);
}

.auth-actions {
  display: flex;
  gap: var(--sp-3);
}

.link {
  border: 0;
  background: none;
  padding: 0;
  font-size: var(--fs-xs);
  color: var(--c-accent);
  cursor: pointer;
}
.link:hover:not(:disabled) {
  text-decoration: underline;
}

.link--danger {
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
