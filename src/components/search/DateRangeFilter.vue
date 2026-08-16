<script setup lang="ts">
/**
 * A STAC `datetime` interval from two date pickers.
 *
 * Either end may be left open — "everything since 2020" is a far more common
 * request here than a closed range, since the interesting question is usually
 * "what is the newest imagery of this place".
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ modelValue: string | null }>()
const emit = defineEmits<{ 'update:modelValue': [value: string | null] }>()

const { t } = useI18n()

const from = ref('')
const to = ref('')

/** `2024-05-31T09:21:07Z` or `..` back to the `YYYY-MM-DD` an input wants. */
function toDateInput(value: string | undefined): string {
  if (!value || value === '..') return ''
  return value.slice(0, 10)
}

// Parse an incoming interval so a shared URL repopulates the pickers.
watch(
  () => props.modelValue,
  (value) => {
    if (!value) {
      from.value = ''
      to.value = ''
      return
    }
    const [start, end] = value.split('/')
    from.value = toDateInput(start)
    to.value = toDateInput(end ?? start)
  },
  { immediate: true },
)

function emitInterval() {
  const start = from.value ? `${from.value}T00:00:00Z` : '..'
  // The end date is inclusive to the user, so run it to the last second of
  // the day rather than to midnight, which would drop that day's items.
  const end = to.value ? `${to.value}T23:59:59Z` : '..'

  if (start === '..' && end === '..') {
    emit('update:modelValue', null)
    return
  }
  emit('update:modelValue', `${start}/${end}`)
}

function clear() {
  from.value = ''
  to.value = ''
  emit('update:modelValue', null)
}

const isReversed = computed(() =>
  Boolean(from.value && to.value && from.value > to.value),
)
</script>

<template>
  <fieldset class="dates">
    <legend class="legend">{{ t('search.dates.legend') }}</legend>

    <div class="grid">
      <label class="field">
        <span class="field-label">{{ t('search.dates.from') }}</span>
        <input
          v-model="from"
          type="date"
          class="field-input"
          @change="emitInterval"
        />
      </label>
      <label class="field">
        <span class="field-label">{{ t('search.dates.to') }}</span>
        <input
          v-model="to"
          type="date"
          class="field-input"
          @change="emitInterval"
        />
      </label>
    </div>

    <p v-if="isReversed" class="warning" role="alert">
      {{ t('search.dates.reversed') }}
    </p>
    <p v-else class="hint">{{ t('search.dates.openEndedHint') }}</p>

    <button v-if="modelValue" type="button" class="clear" @click="clear">
      {{ t('search.dates.clear') }}
    </button>
  </fieldset>
</template>

<style scoped>
.dates {
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
  gap: var(--sp-2);
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
}

.hint {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
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
