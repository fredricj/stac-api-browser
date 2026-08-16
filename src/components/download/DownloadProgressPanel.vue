<script setup lang="ts">
/**
 * What the download is actually doing.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { QueueSnapshot, TaskStatus } from '@/services/downloader'
import { formatBytes, formatCount } from '@/utils/format'

const props = defineProps<{ snapshot: QueueSnapshot }>()

const emit = defineEmits<{
  pause: []
  resume: []
  cancel: []
  retryFailed: []
}>()

const { t, locale } = useI18n()

const percent = computed(() => {
  const { receivedBytes, totalBytes } = props.snapshot
  if (totalBytes <= 0) return 0
  return Math.min(100, Math.round((receivedBytes / totalBytes) * 100))
})

const active = computed(() =>
  props.snapshot.tasks.filter((task) => task.status === 'active'),
)

const failures = computed(() =>
  props.snapshot.tasks.filter((task) => task.status === 'failed'),
)

const isRunning = computed(() => props.snapshot.state === 'running')
const isPaused = computed(() => props.snapshot.state === 'paused')
const isFinished = computed(() => props.snapshot.state === 'finished')

/** 401 and 403 need different advice from a network blip. */
function failureText(failure: string | undefined): string {
  return t(`download.failure.${failure ?? 'http'}`)
}

function statusLabel(status: TaskStatus): string {
  return t(`download.status.${status}`)
}
</script>

<template>
  <section class="progress" :aria-label="t('download.progressLabel')">
    <div
      class="bar"
      role="progressbar"
      :aria-valuenow="percent"
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <div class="bar-fill" :style="{ width: `${percent}%` }" />
    </div>

    <p class="totals" role="status" aria-live="polite">
      <span class="pct">{{ percent }}%</span>
      <span>
        {{ formatBytes(snapshot.receivedBytes, locale) }} /
        {{ formatBytes(snapshot.totalBytes, locale) }}
      </span>
      <span class="counts">
        {{
          t('download.counts', {
            done: formatCount(snapshot.done, locale),
            total: formatCount(snapshot.tasks.length, locale),
          })
        }}
        <template v-if="snapshot.skipped">
          · {{ t('download.skippedCount', { count: snapshot.skipped }) }}
        </template>
        <template v-if="snapshot.failed">
          · {{ t('download.failedCount', { count: snapshot.failed }) }}
        </template>
      </span>
    </p>

    <!-- The files moving right now, so a long run never looks stalled. -->
    <ul v-if="active.length" class="active">
      <li v-for="task in active" :key="task.key" class="active-row">
        <span class="active-name">{{ task.filename }}</span>
        <span class="active-bytes">
          {{ formatBytes(task.received, locale) }}
          <template v-if="task.total">
            / {{ formatBytes(task.total, locale) }}
          </template>
        </span>
      </li>
    </ul>

    <div class="controls">
      <button v-if="isRunning" type="button" class="btn" @click="emit('pause')">
        {{ t('download.pause') }}
      </button>
      <button v-if="isPaused" type="button" class="btn" @click="emit('resume')">
        {{ t('download.resume') }}
      </button>
      <button
        v-if="!isFinished"
        type="button"
        class="btn btn--danger"
        @click="emit('cancel')"
      >
        {{ t('download.cancel') }}
      </button>
      <button
        v-if="isFinished && failures.length"
        type="button"
        class="btn"
        @click="emit('retryFailed')"
      >
        {{ t('download.retryFailed', { count: failures.length }) }}
      </button>
    </div>

    <!-- Named, not counted: a run that ends with "3 failed" and no names is a
         run the user has to start over. -->
    <div v-if="failures.length" class="failures">
      <h3 class="failures-title">{{ t('download.failuresTitle') }}</h3>
      <ul class="failure-list">
        <li v-for="task in failures" :key="task.key" class="failure">
          <span class="failure-name">{{ task.filename }}</span>
          <span class="failure-why">{{ failureText(task.failure) }}</span>
        </li>
      </ul>
    </div>

    <p v-if="isFinished" class="summary">
      {{
        t('download.finished', {
          done: snapshot.done,
          skipped: snapshot.skipped,
          failed: snapshot.failed,
        })
      }}
    </p>

    <details v-if="snapshot.tasks.length" class="all">
      <summary>{{ t('download.showAll') }}</summary>
      <ul class="all-list">
        <li v-for="task in snapshot.tasks" :key="task.key" class="all-row">
          <span class="all-name">{{ task.filename }}</span>
          <span class="all-status" :class="`is-${task.status}`">
            {{ statusLabel(task.status) }}
          </span>
        </li>
      </ul>
    </details>
  </section>
</template>

<style scoped>
.progress {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

.bar {
  height: 0.5rem;
  border-radius: var(--r-full);
  background: var(--c-surface-2);
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  background: var(--c-accent);
  transition: width var(--transition);
}

.totals {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--sp-3);
  font-size: var(--fs-sm);
  font-variant-numeric: tabular-nums;
  color: var(--c-text-muted);
}

.pct {
  font-size: var(--fs-lg);
  font-weight: 600;
  color: var(--c-text);
}

.counts {
  margin-left: auto;
  font-size: var(--fs-xs);
}

.active {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  max-height: 8rem;
  overflow-y: auto;
}

.active-row,
.failure,
.all-row {
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
  font-size: var(--fs-xs);
}

.active-name,
.failure-name,
.all-name {
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1 1 auto;
  min-width: 0;
}

.active-bytes {
  color: var(--c-text-faint);
  font-variant-numeric: tabular-nums;
  flex: none;
}

.controls {
  display: flex;
  gap: var(--sp-2);
}

.btn {
  padding: var(--sp-1) var(--sp-3);
  border: 1px solid var(--c-border-strong);
  border-radius: var(--r-md);
  background: var(--c-surface);
  font-size: var(--fs-sm);
  cursor: pointer;
}
.btn:hover {
  background: var(--c-surface-hover);
}
.btn--danger {
  color: var(--c-danger);
  border-color: var(--c-danger);
}

.failures {
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-md);
  background: var(--c-danger-bg);
}

.failures-title {
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--c-danger);
  margin-bottom: var(--sp-1);
}

.failure-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  max-height: 10rem;
  overflow-y: auto;
}

.failure-why {
  flex: none;
  color: var(--c-danger);
}

.summary {
  font-size: var(--fs-sm);
  color: var(--c-text);
}

.all {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}

.all summary {
  cursor: pointer;
}

.all-list {
  list-style: none;
  margin-top: var(--sp-2);
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  max-height: 12rem;
  overflow-y: auto;
}

.all-status {
  flex: none;
}
.all-status.is-done {
  color: var(--c-success);
}
.all-status.is-skipped {
  color: var(--c-text-faint);
}
.all-status.is-failed {
  color: var(--c-danger);
}
.all-status.is-active {
  color: var(--c-accent);
}
</style>
