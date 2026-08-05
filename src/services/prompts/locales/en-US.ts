/**
 * 内置 Prompt 模板英文版（en-US）
 *
 * 覆盖 EDITABLE_PROMPT_KEYS 的用户可编辑模板（Issue #18）。
 * 翻译规则：
 * - 占位符 {{xxx}} 必须与中文版完全一致（渲染链按英文 key 注入）
 * - 仅翻译 content 指令文本；systemSuffix/systemRole 保持中文原文
 *   （系统约束在设置页不可见，渲染时追加；完整本地化列为后续迭代）
 * - 空段落裁剪（★【...】★ 等中文标签）对英文模板不生效，无害
 */
/** 模板 key → en-US 内容 */
export const EN_US_CONTENT: Partial<Record<string, string>> = {
  'generate_global_config': `Based on the author's one-line idea or initial concept, expand and complete the global bestselling settings of a novel following the most mature and commercially powerful web novel core structures on the market today.

Author's initial idea:
{{user_idea}}

Novel scale (IMPORTANT: design pacing strictly according to these parameters):
- Planned total chapters: {{number_of_chapters}}
- Words per chapter: {{word_number}}
- Approximate total word count: {{number_of_chapters}} × {{word_number}}

【Core Task Requirements】
1. Deep-mine commercial value: extract strong "satisfaction points" and "emotional pain points", building a highly tense setup-development-climax-resolution arc.
2. Professional setting design: apply "character map" and "three-dimensional worldview" principles. No empty grandiosity — every setting must serve plot advancement and generate direct conflict.
3. Market fit: if the author did not specify a base genre, infer the most marketable booming genre.
4. Customized pacing: the chapter ranges and small/medium/major climax frequencies in globalGuidance must be strictly derived from the actual scale of 【{{number_of_chapters}} chapters】. Numbers inconsistent with the real chapter count are forbidden.
5. Smart recommendation: recommend the most suitable story structure and narrative POV based on genre and subject matter.`,

  'premise': `Please refine this book's Story Premise. This is a 【{{genre}}】 novel (sub-genre: {{sub_genre}}).

【Core Setting Parameters】
- Core outline: {{topic}}
- Target audience: {{target_audience}}
- Expected length: ~{{number_of_chapters}} chapters ({{word_number}} words each)
- World foundation: {{core_setting}}
- Core golden finger/system: {{golden_finger}}
- Protagonist profile: {{protagonist_profile}}
- Global writing requirements and taboos: {{global_guidance}}

【Generation Task】
Generate a structured story premise of 300-500 words, strictly organized into the four sections below:

## One-Line Premise (Logline)
Condense the core of the book in 30-50 words: "When [protagonist identity] faces [triggering event], they must [core action] or [disastrous consequence]."

## Core Conflict Chain
Expand: the protagonist's initial predicament → the equilibrium-breaking trigger event → the core mainline goal → the major opposing forces. (~100 words)

## Golden Finger Positioning
Detail: how the golden finger is acquired → its core mechanics and functions → interaction points with world rules → progression path and limitations/costs. (~100-150 words)

## Suspense Skeleton
Describe: the visible conflict line (current biggest threat) + hidden mainline hints (ultimate suspense / deeper truth). (~100 words)

【Requirements】
1. The golden finger must be a core means of driving the plot — describe its unique mechanics concretely, no vagueness.
2. Must reflect the protagonist's core desire or obsession rooted in the setup.
3. The conflict chain must include two layers: visible enemies and a deeper crisis.
4. Strictly avoid the toxic points listed in the global writing requirements and taboos.
5. Use the Markdown section headings above as separators; do not add extra explanations.

【Reference works for tone (if any, may follow their tone and pacing)】
{{reference_works}}`,

  'character_dynamics': `Based on the story premise, craft a highly dramatic core character map for this book.

【Reference Parameters】
- Genre: {{genre}}
- Story premise: {{premise}}
- Preset protagonist profile: {{protagonist_profile}}
- Golden finger system: {{golden_finger}}
- World background: {{world_building}}
- Expected length: ~{{number_of_chapters}} chapters
- Global writing requirements and taboos: {{global_guidance}}

【Generation Task】
Around the protagonist, design a reasonable number of core characters matching the book's length ({{number_of_chapters}} chapters) — 3-4 for short works, 4-6 for medium/long works. Avoid stereotyped characters. Generate the character map with this structure:

1. 【First Core: Protagonist】
- Surface pursuit vs. ultimate desire (complete the light/dark sides of the personality from the profile)
- Signature appearance traits (attire, aura, distinctive marks, etc.)
- Golden finger usage style (design unique usage habits or combat/leveling strategies based on the mechanics of 「{{golden_finger}}」)
- Soul weakness and expected transformation (character arc starting point → destination)

2. 【Core Character Camp】
For each character provide: name/code name, background, signature appearance traits, relational tension with the protagonist, hidden secrets.
Design principles (flexible template — configure to story needs):
- At least 1 ally/companion with deep bonds to the protagonist (complementary, not subservient)
- At least 1 rival/opponent ideologically opposed to the protagonist (with legitimate motivations of their own)
- Optional: 1 hidden wildcard/gray character (uncommitted, may bring reversals)
- Optional: mentor, schemer, faction representative, etc. as the story requires

3. 【Core Conflict Web】
Briefly describe how all characters inevitably collide through survival pressure, resource competition, or belief conflicts within the worldview.

【Requirements】
1. The protagonist must strictly conform to the preset profile tone; no deviation.
2. All characters must fit reader expectations of the 「{{genre}}」 genre.
3. By default avoid saintly (too pure) characters, dumbed-down villains, or pure plot tools (unless the author explicitly requests them).
4. Return only the character map text — no pleasantries.

【Reference works for tone (if any, may follow their tone and pacing)】
{{reference_works}}`,

  'world_building': `Transform the basic settings into a "story playground" that directly generates conflict.

【Reference Parameters】
- Genre: {{genre}}
- Story premise: {{premise}}
- Core worldview settings: {{core_setting}}
- Golden finger system: {{golden_finger}}
- Protagonist positioning: {{protagonist_profile}}
- Global writing requirements and taboos: {{global_guidance}}

【Generation Task】
Based on the core worldview and the traits of the 「{{genre}}」 genre, build the worldview across the three dimensions below. Every setting must "carry built-in conflict points" that directly drive the plot.

1. 【Core Rules and System Loopholes】
- What are the core operating rules of this world? (Depending on genre: cultivation system, tech level, social system, supernatural laws, etc.)
- What is the absolute advantage within the rules? How does the protagonist's golden finger 「{{golden_finger}}」 gain a unique asymmetric advantage under these rules?

2. 【Class Fault Lines and Resource Battlegrounds】
- What irreconcilable faction/class/camp oppositions exist in this world?
- What is the scarcest core resource? How is it distributed? Where does the protagonist stand, and from whom must they compete for it?

3. 【Metaphor and Deep Crisis】
- What is the ultimate catastrophe or greatest mystery behind the world?
- What forbidden lore, historical lies, or buried truths happen to intersect with the protagonist's fate?

【Requirements】
1. All settings must revolve around the core appeal of the 「{{genre}}」 genre — no filler settings that cannot enter the story.
2. The interaction between the golden finger and world rules must be concrete and actionable, no hand-waving.
3. Strictly follow the global writing requirements and taboos; no breaking canon.
4. Return only the worldview setting text — no irrelevant code or explanations.`,

  'synopsis': `Integrate all previously generated fragments into the book-wide plot outline.

【Core Assets】
- Genre: {{genre}}
- Narrative POV: {{narrative_pov}}
- Story premise: {{premise}}
- Character map: {{character_dynamics}}
- Worldview matrix: {{world_building}}
- Global writing requirements and taboos: {{global_guidance}}

【Length Parameters (extremely important! Structural nodes must be strictly based on these)】
- Planned total chapters: {{number_of_chapters}}
- Words per chapter: {{word_number}}
- Approximate total word count: {{number_of_chapters}} × {{word_number}}

【Story Structure Mode — organize the outline strictly by the following structure】
{{plot_structure_guide}}

【Generation Task】
Rigorously extrapolate the book-wide plot outline. Write "structural turning points" rather than fine-grained outlines. Adjust pacing strategy to the core appeal of the 「{{genre}}」 genre.

【Requirements】
1. Chapter ranges for structural nodes must be concretely marked based on the actual scale of 【{{number_of_chapters}} chapters】; numbers inconsistent with the real chapter count are forbidden.
2. Every structural node must state "what specifically happens" — no vagueness.
3. Pacing strategy must match the 「{{genre}}」 genre (e.g., power-fantasy: face-slapping and leveling rhythm; mystery: clues and reversals; romance: emotion and misunderstanding).
4. The narrative POV is 「{{narrative_pov}}」 — design must account for how POV constraints affect information revelation and suspense creation.
5. Never touch the toxic points in the global writing requirements and taboos.
6. Return only the pure plot outline text — no filler or narration.`,

  'first_chapter_draft': `Please begin writing the first chapter of this novel (the icebreaking chapter).

【Full-Book Settings Pool】
{{architecture}}

【Chapter Information】
{{chapter_info}}

【Future Chapter Outlines Preview】(for understanding where the plot is heading — absolutely DO NOT write future content in this chapter!)
{{future_blueprints}}

【Global Writing Requirements】
{{global_guidance}}

【Web Novel "Golden First Chapter" Rules】
1. Open with high intensity (golden three seconds): never open with long worldbuilding exposition. The first sentence must cut directly into an action, a high-pressure interrogation, a chase, or a scene of crushing contrast.
2. Reveal the golden finger skillfully: at the protagonist's deepest predicament, reveal the golden finger in a way that builds anticipation.
3. Show, don't tell (action and dialogue driven): never use dry god's-eye declarative sentences — convert everything to "character dialogue + expression description + action interaction".
4. Avoid toxic points: strictly steer clear of the global writing requirements and taboos.

【Style Requirements (if any, follow strictly)】
{{writing_style}}`,

  'next_chapter_draft': `You are serializing the latest chapter.

【Plot Memory Bank and Preceding Break Context】
- [Overall plot progress]: {{global_summary}}
- [Character state monitor]: {{character_states}}
- [Recent three chapters summary]: {{short_summary}}
★【The final passage of the previous chapter (extremely critical — the opening must seamlessly continue from it)】★:
{{previous_ending}}

【This Chapter's Writing Direction and Core Task】
{{chapter_info}}

【Future Chapter Outlines Preview】(for understanding where the plot is heading — absolutely DO NOT write future content in this chapter!)
{{future_blueprints}}

【Knowledge Base Materials (if any)】
{{filtered_context}}

【Web Novel Serialization Core Rules】
1. Seamless continuation: your first paragraph must naturally and smoothly continue the previous chapter's ending — no scene teleporting or abrupt POV jumps.
2. Action and expression driven: use dynamic description to advance the plot. Don't write "they chatted for a long time" — use the sound of a sword being drawn, tea dripping, pupils contracting.
3. Deliver this chapter's core conflict: use roughly {{word_number}} words (the system verifies word count automatically — no need to count manually, trust your sense of pacing), thoroughly complete this chapter's goal. No bland filler.
4. Suspense chapter ending: the final paragraph must end on a mini-climax or sudden turn.
5. Bottom-line rule: never touch the 【global writing requirements and taboos】: {{global_guidance}}.

【Style Requirements (if any, follow strictly)】
{{writing_style}}`,

  'refine_chapter': `Polish and detail-fill the chapter draft.

【Plot Context】
- Book-wide progress summary: {{global_summary}}
- Recent chapter review: {{short_summary}}

【Chapter Information】
{{chapter_info}}

【Refinement Requirements】
1. Sense of Presence: strengthen environmental description through "five senses" details (sight, sound, smell, touch). Reject dry, bland narration.
2. Setting integration: weave golden finger usage details into combat or negotiation, showcasing the protagonist's differentiated advantage.
3. Emotional tension: strengthen the villain's oppressive presence and the protagonist's counterattack force. Follow "rise after suppression," but deliver full satisfaction at the climax.
4. Vocabulary upgrade: use more precise, cinematic action words. Show emotions through action and detail (Show, Don't Tell).
5. Hook and pacing: check whether the ending has a strong hook that compels readers to continue.
6. Anti-filler rule: refinement means vocabulary replacement and improved imagery — NEVER padding length or adding verbose narration. Target ~{{word_number}} words (the system verifies word count automatically — no need to count manually). If the original has wordy action description or didactic exposition, cut it decisively. No runaway expansion that slows pacing.
7. OOC check: line by line, verify character dialogue matches identity and personality (refer to the injected voice profile: tone/word choices/sentence length/register). Rewrite any line that sounds out of character. A character must not speak in two completely different styles within the same chapter.

【Global Writing Taboos】
{{global_guidance}}

【Original Draft to Refine】
{{draft_content}}

【Style Requirements (if any, refine strictly toward this style)】
{{writing_style}}`,

  'consistency_check': `Review the following chapter.

【Chapter to Review】
{{chapter_content}}

【Character States】
{{character_states}}

【Global Summary】
{{global_summary}}

【Worldbuilding Settings】
{{world_building}}

【Review Principles】
1. Evidence-based: only report issues with explicit textual evidence. Each issue must quote the exact original sentence.
2. Quality over quantity: for dimensions without problems, output a single record with severity pass. Do not pad the count.
3. Consistency only, no style critique: do not report style preferences, writing advice, or creative suggestions. Only report verifiable factual contradictions.
4. Objectively verifiable: every reported issue must be confirmable by a third-party editor.

【Check Dimensions】
1. Plot continuity: does this chapter contradict earlier content (global summary)? Does it contradict itself?
2. Plot plausibility: is the causal logic sound? Are character motivations reasonable? Any common-sense errors?
3. Character states: do character behavior, abilities, location, and emotions match the character state records?
4. Cross-chapter linkage: are foreshadowings and suspense continuous? Any abrupt plot events without established cause?
5. Foreshadowing integrity: are there earlier foreshadowings that should have been resolved but weren't? Any new additions conflicting with the known foreshadowing system?`,

  'analyze_writing_style': `Read the following novel excerpt carefully, deeply analyze and extract the author's writing style fingerprint.

【Text Sample】
{{sample_text}}

【Analysis Dimensions and Output Requirements】
Analyze across the following 7 dimensions. Summarize each dimension precisely in 2-3 sentences, with 1 quoted example sentence as evidence (300-500 words total):

1. Narrative pacing: overall speed, scene transition frequency, paragraph length preference
2. Description density: proportion of environmental/action/psychological description
3. Dialogue style: proportion of dialogue in the text, colloquialism level, use of dialect or special tones
4. Word choice: preference for classical/contemporary/technical terms, overall vocabulary richness
5. Emotional tone: overall hot-blooded/bleak/humorous/heavy/light
6. POV habits: main person used, frequency of POV switching, use of internal monologue
7. Signature techniques: the author's unique rhetorical devices, common transition tricks, distinctive paragraph structures

【Output Format】
Output pure text analysis directly, using this format:

Narrative pacing: …
Description density: …
Dialogue style: …
Word choice: …
Emotional tone: …
Narrative POV: …
Signature techniques: …

Do not add any irrelevant explanations or pleasantries.`,

  'refine_from_review': `Precisely repair the draft according to the issues listed in the 【Review Report】.

【Review Report】
{{review_report}}

【Draft to Repair】
{{draft_content}}

【Global Writing Requirements】
{{global_guidance}}

【Repair Principles】
1. Only fix issues explicitly identified in the review report — resolve them one by one.
2. Do not polish or rewrite anything not mentioned in the report.
3. Preserve the original style, pacing, and length.
4. Minimal-change principle for every edit — the fewer changes the better; solve the problem itself and nothing more.`,
}
