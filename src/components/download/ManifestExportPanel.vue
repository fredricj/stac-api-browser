<script setup lang="ts">
/**
 * Tier 3: hand the job to a real download manager.
 *
 * Not a consolation prize. For tens of gigabytes aria2c resumes, parallelises
 * and survives a closed laptop, none of which a browser tab does — so this is
 * offered as the recommended route above the threshold rather than as the
 * thing you fall back to when the good options fail.
 */
import { useI18n } from 'vue-i18n'
import { useSelectionStore } from '@/stores/selectionStore'
import {
  PASSWORD_ENV,
  USER_ENV,
  buildManifest,
  saveManifest,
  type ManifestFormat,
} from '@/services/manifest'
import { safeFilename } from '@/services/fsAccess'

const { t } = useI18n()
const selection = useSelectionStore()

/** Ordered by how useful each is for a large job. */
const FORMATS: Array<{ format: ManifestFormat; key: string }> = [
  { format: 'aria2c', key: 'aria2c' },
  { format: 'curl', key: 'curl' },
  { format: 'wget', key: 'wget' },
  { format: 'powershell', key: 'powershell' },
  { format: 'urls', key: 'urls' },
  { format: 'csv', key: 'csv' },
  { format: 'geojson', key: 'geojson' },
]

function download(format: ManifestFormat) {
  saveManifest(
    buildManifest(format, selection.items, (item) =>
      safeFilename(item.href ?? '', item.id),
    ),
  )
}
</script>

<template>
  <section class="manifest">
    <p class="intro">{{ t('download.manifest.intro') }}</p>

    <!-- Stated up front, because the whole point is that these files can be
         shared and committed without leaking anything. -->
    <p class="credentials">
      {{
        t('download.manifest.credentials', {
          user: USER_ENV,
          password: PASSWORD_ENV,
        })
      }}
    </p>

    <ul class="formats">
      <li v-for="entry in FORMATS" :key="entry.format">
        <button
          type="button"
          class="format"
          :disabled="selection.isEmpty"
          @click="download(entry.format)"
        >
          <span class="format-name">
            {{ t(`download.manifest.formats.${entry.key}.name`) }}
          </span>
          <span class="format-hint">
            {{ t(`download.manifest.formats.${entry.key}.hint`) }}
          </span>
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.manifest {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

.intro {
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}

.credentials {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  background: var(--c-surface-2);
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-sm);
}

.formats {
  list-style: none;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
  gap: var(--sp-2);
}

.format {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  width: 100%;
  height: 100%;
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--c-border-strong);
  border-radius: var(--r-md);
  background: var(--c-surface);
  text-align: left;
  cursor: pointer;
}
.format:hover:not(:disabled) {
  background: var(--c-surface-hover);
}
.format:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.format-name {
  font-size: var(--fs-sm);
  font-weight: 600;
}

.format-hint {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
</style>
