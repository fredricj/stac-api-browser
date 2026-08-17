<script setup lang="ts">
/**
 * Filter controls generated from `/queryables`.
 *
 * Nothing here knows what `upplosning` or `flygar` mean. The catalog
 * publishes its filterable properties as JSON Schema — types, bounds and all
 * — so the panel is built from that rather than hardcoded per API. Adding a
 * catalog therefore costs no code, and a catalog that changes its properties
 * does not silently keep offering the old ones.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  emptyValue,
  type QueryableField,
  type QueryableValue,
  type QueryableValues,
} from '@/services/queryables'
import type { SearchError } from '@/stores/searchStore'
import { labelForProperty } from '@/utils/propertyLabels'

const props = defineProps<{
  fields: QueryableField[]
  values: QueryableValues
  loading?: boolean
  error?: SearchError | null
}>()

const emit = defineEmits<{
  'update:values': [values: QueryableValues]
  retry: []
}>()

const { t, locale } = useI18n()

/** The schema's title is Swedish; translate the ones we know, keep the rest. */
function label(field: QueryableField): string {
  return labelForProperty(field.name, locale.value) ?? field.label
}

function valueFor(field: QueryableField): QueryableValue {
  return props.values[field.name] ?? emptyValue(field)
}

/* Narrowing accessors, so the template stays free of casts. Each returns the
   blank value when the stored one is of another kind, which can happen after
   a catalog changes a property's type under a bookmarked URL. */

function numberValue(field: QueryableField): {
  min: number | null
  max: number | null
} {
  const value = valueFor(field)
  return value.kind === 'number'
    ? { min: value.min ?? null, max: value.max ?? null }
    : { min: null, max: null }
}

function enumSelected(field: QueryableField): string[] {
  const value = valueFor(field)
  return value.kind === 'enum' ? value.selected : []
}

function textValue(field: QueryableField): string {
  const value = valueFor(field)
  return value.kind === 'string' ? value.text : ''
}

function update(field: QueryableField, value: QueryableValue) {
  emit('update:values', { ...props.values, [field.name]: value })
}

function updateNumber(field: QueryableField, part: 'min' | 'max', raw: string) {
  const current = valueFor(field)
  if (current.kind !== 'number') return

  const parsed = raw.trim() === '' ? null : Number(raw)
  update(field, {
    ...current,
    [part]: parsed !== null && Number.isFinite(parsed) ? parsed : null,
  })
}

function toggleEnum(field: QueryableField, option: string) {
  const current = valueFor(field)
  if (current.kind !== 'enum') return

  const selected = current.selected.includes(option)
    ? current.selected.filter((value) => value !== option)
    : [...current.selected, option]
  update(field, { kind: 'enum', selected })
}

function updateText(field: QueryableField, raw: string) {
  update(field, { kind: 'string', text: raw })
}

function reset() {
  emit('update:values', {})
}

const hasAnyValue = computed(() => Object.keys(props.values).length > 0)

/** `0.16` needs a finer step than `2025` does. */
function stepFor(field: QueryableField): number | 'any' {
  if (field.integer) return 1
  const span = (field.maximum ?? 0) - (field.minimum ?? 0)
  return span > 0 && span <= 10 ? 0.01 : 'any'
}
</script>

<template>
  <fieldset v-if="loading || fields.length || error" class="queryables">
    <legend class="legend">{{ t('search.queryables.legend') }}</legend>

    <p v-if="loading" class="status">{{ t('search.queryables.loading') }}</p>

    <div v-else-if="error" class="error" role="alert">
      <p class="error-text">{{ t('search.queryables.error') }}</p>
      <p v-if="error.likelyCors" class="error-hint">
        {{ t('search.results.corsHint') }}
      </p>
      <button type="button" class="retry" @click="emit('retry')">
        {{ t('common.retry') }}
      </button>
    </div>

    <div v-for="field in fields" :key="field.name" class="field-block">
      <p class="field-name">
        {{ label(field) }}
        <span v-if="field.description" class="field-hint">
          {{ field.description }}
        </span>
      </p>

      <!-- Numeric range. The min/max come from the schema, so the control
           cannot ask for a value the catalog has never held. -->
      <div v-if="field.kind === 'number'" class="range">
        <label class="range-part">
          <span class="sr-only">
            {{ t('search.queryables.min', { field: label(field) }) }}
          </span>
          <input
            type="number"
            class="range-input"
            :min="field.minimum"
            :max="field.maximum"
            :step="stepFor(field)"
            :placeholder="
              field.minimum != null
                ? String(field.minimum)
                : t('search.queryables.minShort')
            "
            :value="numberValue(field).min ?? ''"
            @input="
              updateNumber(
                field,
                'min',
                ($event.target as HTMLInputElement).value,
              )
            "
          />
        </label>
        <span class="range-dash" aria-hidden="true">–</span>
        <label class="range-part">
          <span class="sr-only">
            {{ t('search.queryables.max', { field: label(field) }) }}
          </span>
          <input
            type="number"
            class="range-input"
            :min="field.minimum"
            :max="field.maximum"
            :step="stepFor(field)"
            :placeholder="
              field.maximum != null
                ? String(field.maximum)
                : t('search.queryables.maxShort')
            "
            :value="numberValue(field).max ?? ''"
            @input="
              updateNumber(
                field,
                'max',
                ($event.target as HTMLInputElement).value,
              )
            "
          />
        </label>
      </div>

      <!-- Enumerated values: a multi-select, emitted as CQL2 `in`. -->
      <div v-else-if="field.kind === 'enum'" class="options">
        <label
          v-for="option in field.options"
          :key="option"
          class="option-chip"
          :class="{ 'is-on': enumSelected(field).includes(option) }"
        >
          <input
            type="checkbox"
            class="sr-only"
            :checked="enumSelected(field).includes(option)"
            @change="toggleEnum(field, option)"
          />
          {{ option }}
        </label>
      </div>

      <input
        v-else
        type="text"
        class="text-input"
        :placeholder="t('search.queryables.textPlaceholder')"
        :value="textValue(field)"
        @input="updateText(field, ($event.target as HTMLInputElement).value)"
      />
    </div>

    <button v-if="hasAnyValue" type="button" class="link" @click="reset">
      {{ t('search.queryables.reset') }}
    </button>
  </fieldset>
</template>

<style scoped>
.queryables {
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  padding: var(--sp-3);
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

.legend {
  font-size: var(--fs-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--c-text-faint);
  padding-inline: var(--sp-1);
}

.status {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}

.error {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--sp-2);
  padding: var(--sp-3);
  border-radius: var(--r-md);
  background: var(--c-danger-bg);
}

.error-text {
  font-size: var(--fs-xs);
  color: var(--c-danger);
}

.error-hint {
  font-size: var(--fs-xs);
  color: var(--c-danger);
  opacity: 0.9;
}

.retry {
  padding: var(--sp-1) var(--sp-3);
  border: 1px solid var(--c-danger);
  border-radius: var(--r-sm);
  background: var(--c-surface);
  color: var(--c-danger);
  font-size: var(--fs-xs);
  cursor: pointer;
}
.retry:hover {
  background: var(--c-danger-bg);
}

.field-block {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}

.field-name {
  font-size: var(--fs-sm);
  font-weight: 500;
}

.field-hint {
  display: block;
  font-size: var(--fs-xs);
  font-weight: 400;
  color: var(--c-text-faint);
}

.range {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}

.range-part {
  flex: 1 1 0;
  min-width: 0;
}

.range-input {
  width: 100%;
  padding: var(--sp-1) var(--sp-2);
  border: 1px solid var(--c-border-strong);
  border-radius: var(--r-sm);
  background: var(--c-bg);
  font-size: var(--fs-sm);
  font-family: var(--font-mono);
}

.range-dash {
  color: var(--c-text-faint);
}

.options {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-1);
}

.option-chip {
  padding: var(--sp-1) var(--sp-2);
  border: 1px solid var(--c-border-strong);
  border-radius: var(--r-full);
  background: var(--c-surface);
  font-size: var(--fs-xs);
  font-family: var(--font-mono);
  cursor: pointer;
}
.option-chip:hover {
  background: var(--c-surface-hover);
}
/* Border as well as fill: selection must never rest on colour alone. */
.option-chip.is-on {
  background: var(--c-accent-bg);
  border-color: var(--c-accent);
  color: var(--c-accent);
  font-weight: 600;
}

.text-input {
  padding: var(--sp-1) var(--sp-2);
  border: 1px solid var(--c-border-strong);
  border-radius: var(--r-sm);
  background: var(--c-bg);
  font-size: var(--fs-sm);
}

.link {
  align-self: flex-start;
  border: 0;
  background: none;
  padding: 0;
  font-size: var(--fs-xs);
  color: var(--c-accent);
  cursor: pointer;
}
.link:hover {
  text-decoration: underline;
}
</style>
