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
import DownloadProgressPanel from '@/components/download/DownloadProgressPanel.vue'
import ManifestExportPanel from '@/components/download/ManifestExportPanel.vue'

/**
 * Above this, a browser is the wrong tool and the dialog recommends aria2c.
 * Chosen to be roughly "more than an afternoon": ~20 tiles of this catalog.
 */
const MANIFEST_THRESHOLD_BYTES = 20e9

const { t, locale } = useI18n()
const selection = useSelectionStore()
const auth = useAuthStore()

const dialog = useTemplateRef<HTMLDialogElement>('dialog')

const canStreamToFolder = isDirectoryPickerSupported()

const snapshot = ref<QueueSnapshot | null>(null)
const queue = shallowRef<DownloadQueue | null>(null)
const busy = ref(false)
const problem = ref<string | null>(null)

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
const missingCredentials = computed(
  () => credentials.value === null && selection.items.some((item) => item.href),
)

const downloadable = computed(() => selection.items.filter((item) => item.href))

function open() {
  problem.value = null
  snapshot.value = null
  queue.value = null
  busy.value = false
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

      <p v-if="missingCredentials" class="warn">
        {{ t('download.signInFirst') }}
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
        </fieldset>

        <ManifestExportPanel v-if="tier === 'manifest'" />

        <p v-if="tier === 'sequential'" class="warn">
          {{ t('download.sequentialWarning') }}
        </p>
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
          v-if="!snapshot && tier === 'sequential'"
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
  color: #fff;
}
.btn--primary:hover:not(:disabled) {
  background: var(--c-accent-hover);
  border-color: var(--c-accent-hover);
}
</style>
