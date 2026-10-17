// ============================================================
// 抽取层出口
// ============================================================

export { runPipeline, localDedupe, pipelineStats } from "./pipeline.js";
export type { PipelineOptions, PipelineOutput } from "./pipeline.js";
export { mergeEntities, normalizeName, stripAffixes, shouldMerge } from "./entity-merge.js";
export { MAP_SYSTEM, REDUCE_SYSTEM, buildMapPrompt, buildReducePrompt } from "./prompts.js";
