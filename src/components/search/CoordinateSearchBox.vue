<script setup lang="ts">
/**
 * Jump to a coordinate, in whatever form the user happens to have it.
 *
 * The interpretation is always shown back before anything is searched. Silent
 * auto-detection would be worse than no detection at all: a coordinate read
 * the wrong way round lands hundreds of kilometres away, and on a map of
 * Sweden that looks entirely plausible.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BBox2D } from '@/types/stac'
import {
  SUPPORTED_CRS,
  SWEREF99TM,
  WGS84,
  formatLonLat,
  formatProjected,
  fromWgs84,
  parseCoordinateInput,
  type SupportedCrs,
} from '@/utils/projections'
import { useDebouncedRef } from '@/composables/useDebounce'

const props = withDefaults(
  defineProps<{
    /** Catalog's native CRS, offered first in the picker. */
    defaultCrs?: SupportedCrs
  }>(),
  { defaultCrs: WGS84 },
)

const emit = defineEmits<{ locate: [bbox: BBox2D] }>()

const { t } = useI18n()

const text = ref('')
// Reprojection on every keystroke is wasted work, and a read-back that
// flickers between interpretations mid-word is unreadable.
const debouncedText = useDebouncedRef(text, 200)

const crsChoice = ref<SupportedCrs | 'auto'>('auto')
const swapped = ref(false)

const parsed = computed(() =>
  parseCoordinateInput(debouncedText.value, {
    crs: crsChoice.value,
    swapAxes: swapped.value,
  }),
)

const notUnderstood = computed(
  () => debouncedText.value.trim().length > 0 && parsed.value === null,
)

/** The parsed point, echoed in both WGS84 and the catalog's own CRS. */
const readback = computed(() => {
  const result = parsed.value
  if (!result) return null

  if (result.format === 'bbox') {
    return {
      primary: result.bbox.map((v) => v.toFixed(4)).join(', '),
      secondary: null,
    }
  }

  const point = result.point
  if (!point) return null

  const primary = formatLonLat(point.lon, point.lat)
  if (props.defaultCrs === WGS84) return { primary, secondary: null }

  const projected = fromWgs84(point.lon, point.lat, props.defaultCrs)
  return {
    primary,
    secondary: `${formatProjected(projected.x, projected.y)} (${props.defaultCrs})`,
  }
})

/** Named rather than keyed by code: `EPSG:4326` is not a usable i18n path. */
function crsLabel(crs: SupportedCrs): string {
  return crs === SWEREF99TM
    ? t('search.coords.crsSweref')
    : t('search.coords.crsWgs84')
}

const formatLabel = computed(() => {
  const result = parsed.value
  if (!result) return ''
  if (result.format === 'projected') {
    return t('search.coords.formatProjected', { crs: result.crs })
  }
  return t(`search.coords.format.${result.format}`)
})

function submit() {
  const result = parsed.value
  if (result) emit('locate', result.bbox)
}
</script>

<template>
  <form class="coords" @submit.prevent="submit">
    <label class="field">
      <span class="field-label">{{ t('search.coords.label') }}</span>
      <input
        v-model="text"
        type="text"
        class="field-input"
        :placeholder="
          defaultCrs === SWEREF99TM
            ? t('search.coords.placeholderSweref')
            : t('search.coords.placeholder')
        "
        autocomplete="off"
        spellcheck="false"
        :aria-describedby="
          parsed || notUnderstood ? 'coord-readback' : undefined
        "
      />
    </label>

    <label class="crs">
      <span class="sr-only">{{ t('search.coords.crsLabel') }}</span>
      <select v-model="crsChoice" class="crs-select">
        <option value="auto">{{ t('search.coords.crsAuto') }}</option>
        <option v-for="crs in SUPPORTED_CRS" :key="crs" :value="crs">
          {{ crsLabel(crs) }}
        </option>
      </select>
    </label>

    <!-- Polite, not assertive: this updates as the user types, and an
         assertive region would interrupt them mid-word. -->
    <div id="coord-readback" class="readback" role="status" aria-live="polite">
      <template v-if="readback">
        <p class="readback-line">
          <span class="badge">{{ formatLabel }}</span>
          <span class="value">{{ readback.primary }}</span>
        </p>
        <p v-if="readback.secondary" class="readback-line readback-line--muted">
          {{ readback.secondary }}
        </p>
        <!-- Sweden sits where latitude and longitude are both two-digit
             numbers, so this is not a rare edge case here. -->
        <p v-if="parsed?.ambiguous" class="ambiguous">
          {{ t('search.coords.ambiguous') }}
          <button type="button" class="link" @click="swapped = !swapped">
            {{ t('search.coords.swap') }}
          </button>
        </p>
      </template>
      <p v-else-if="notUnderstood" class="unparsed">
        {{ t('search.coords.notUnderstood') }}
      </p>
    </div>

    <button type="submit" class="go" :disabled="!parsed">
      {{ t('search.coords.go') }}
    </button>
  </form>
</template>

<style scoped>
.coords {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}

.field-label {
  font-size: var(--fs-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--c-text-faint);
}

.field-input {
  padding: var(--sp-2);
  border: 1px solid var(--c-border-strong);
  border-radius: var(--r-md);
  background: var(--c-bg);
  font-size: var(--fs-sm);
  font-family: var(--font-mono);
}

.crs-select {
  width: 100%;
  padding: var(--sp-1) var(--sp-2);
  border: 1px solid var(--c-border);
  border-radius: var(--r-sm);
  background: var(--c-surface);
  font-size: var(--fs-xs);
}

.readback:empty {
  display: none;
}

.readback-line {
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
  font-size: var(--fs-xs);
}

.readback-line--muted {
  color: var(--c-text-faint);
  font-family: var(--font-mono);
}

.badge {
  flex: none;
  padding: 0 var(--sp-1);
  border-radius: var(--r-sm);
  background: var(--c-accent-bg);
  color: var(--c-accent);
  font-size: var(--fs-xs);
}

.value {
  font-family: var(--font-mono);
  color: var(--c-text);
  overflow-wrap: anywhere;
}

.ambiguous {
  margin-top: var(--sp-1);
  font-size: var(--fs-xs);
  color: var(--c-warning);
}

.unparsed {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}

.link {
  border: 0;
  background: none;
  padding: 0;
  color: var(--c-accent);
  font-size: inherit;
  cursor: pointer;
  text-decoration: underline;
}

.go {
  align-self: flex-start;
  padding: var(--sp-1) var(--sp-3);
  border: 1px solid var(--c-border-strong);
  border-radius: var(--r-md);
  background: var(--c-surface);
  font-size: var(--fs-sm);
  cursor: pointer;
}
.go:hover:not(:disabled) {
  background: var(--c-surface-hover);
}
.go:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
