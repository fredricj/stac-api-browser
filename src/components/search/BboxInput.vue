<script setup lang="ts">
/**
 * The search extent as four editable numbers.
 *
 * The keyboard equivalent of drawing a box, and the readout while drawing —
 * the two share one value, so a rectangle dragged on the map appears here
 * immediately and a number typed here moves the rectangle.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BBox2D } from '@/types/stac'
import {
  LARGE_AREA_KM2,
  bboxAreaKm2,
  bboxSpanKm,
  isValidBBox,
  normaliseBBox,
} from '@/utils/bbox'

const props = defineProps<{ modelValue: BBox2D | null }>()
const emit = defineEmits<{ 'update:modelValue': [value: BBox2D | null] }>()

const { t, n } = useI18n()

/**
 * Edited as strings, not numbers.
 *
 * Emitting on every keystroke would fire a search the moment someone clears a
 * field to retype it, and `<input type="number">` reports a half-typed
 * "-" or "18." as an empty value — so the draft holds text and only a
 * complete, valid box is published.
 */
const draft = ref<string[]>(['', '', '', ''])

const LABELS = ['west', 'south', 'east', 'north'] as const

function toDraft(bbox: BBox2D | null): string[] {
  return bbox
    ? bbox.map((value) => String(Number(value.toFixed(6))))
    : ['', '', '', '']
}

watch(
  () => props.modelValue,
  (bbox) => {
    // Skip while the draft already says the same thing, so a re-render never
    // reformats what someone is mid-way through typing.
    if (
      bbox &&
      parseDraft(draft.value)?.every((v, i) => Math.abs(v - bbox[i]) < 1e-6)
    ) {
      return
    }
    draft.value = toDraft(bbox)
  },
  { immediate: true },
)

function parseDraft(values: string[]): BBox2D | null {
  const numbers = values.map((value) => Number(value.trim()))
  if (values.some((value) => value.trim() === '')) return null
  if (numbers.some((value) => !Number.isFinite(value))) return null
  return numbers as BBox2D
}

function onInput(index: number, event: Event) {
  const next = [...draft.value]
  next[index] = (event.target as HTMLInputElement).value
  draft.value = next

  const parsed = parseDraft(next)
  if (!parsed) return

  const bbox = normaliseBBox(parsed)
  if (isValidBBox(bbox)) emit('update:modelValue', bbox)
}

function clear() {
  draft.value = ['', '', '', '']
  emit('update:modelValue', null)
}

const area = computed(() =>
  props.modelValue && isValidBBox(props.modelValue)
    ? bboxAreaKm2(props.modelValue)
    : 0,
)

const span = computed(() =>
  props.modelValue && isValidBBox(props.modelValue)
    ? bboxSpanKm(props.modelValue)
    : null,
)

const isLarge = computed(() => area.value > LARGE_AREA_KM2)
</script>

<template>
  <fieldset class="bbox">
    <legend class="legend">{{ t('search.bbox.legend') }}</legend>

    <div class="grid">
      <label
        v-for="(label, index) in LABELS"
        :key="label"
        class="field"
        :class="{ 'field--pole': label === 'north' || label === 'south' }"
        :style="{ gridArea: label }"
      >
        <span class="field-label">{{ t(`search.bbox.${label}`) }}</span>
        <input
          class="field-input"
          type="number"
          inputmode="decimal"
          step="any"
          :value="draft[index]"
          :placeholder="t(`search.bbox.${label}`)"
          @input="onInput(index, $event)"
        />
      </label>
    </div>

    <p v-if="span" class="readout">
      {{
        t('search.bbox.size', {
          width: n(span.width, { maximumFractionDigits: 1 }),
          height: n(span.height, { maximumFractionDigits: 1 }),
          area: n(area, { maximumFractionDigits: 0 }),
        })
      }}
    </p>

    <!-- Item counts grow with the square of the box, and there is no total to
         warn us afterwards, so the warning has to come before the search. -->
    <p v-if="isLarge" class="warning">{{ t('search.bbox.largeArea') }}</p>

    <button v-if="modelValue" type="button" class="clear" @click="clear">
      {{ t('search.bbox.clear') }}
    </button>
  </fieldset>
</template>

<style scoped>
.bbox {
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  padding: var(--sp-3);
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.legend {
  font-size: var(--fs-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--c-text-faint);
  padding-inline: var(--sp-1);
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-areas:
    'north north'
    'west east'
    'south south';
  gap: var(--sp-2);
}

/* North and south each span both columns for centering, but should stay the
   same width as west and east rather than stretching to fill the row. */
.field--pole {
  width: calc(50% - var(--sp-2) / 2);
  justify-self: center;
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  min-width: 0;
}

.field-label {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}

.field-input {
  width: 100%;
  padding: var(--sp-1) var(--sp-2);
  border: 1px solid var(--c-border-strong);
  border-radius: var(--r-sm);
  background: var(--c-bg);
  font-size: var(--fs-sm);
  font-family: var(--font-mono);
}

.readout {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}

.warning {
  font-size: var(--fs-xs);
  color: var(--c-warning);
  background: var(--c-warning-bg);
  padding: var(--sp-2);
  border-radius: var(--r-sm);
}

.clear {
  align-self: flex-start;
  border: 0;
  background: none;
  padding: 0;
  font-size: var(--fs-xs);
  color: var(--c-accent);
  cursor: pointer;
}
.clear:hover {
  text-decoration: underline;
}
</style>
