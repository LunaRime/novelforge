/**
 * 内置 Prompt 模板英文版（en-US）
 *
 * 覆盖全部 19 个模板的 content（EDITABLE_PROMPT_KEYS 11 个 + 系统模板）
 * + systemSuffix（10 个）+ systemRole（16 个）。
 * 翻译规则：
 * - 占位符 {{xxx}} 必须与中文版完全一致（渲染链按英文 key 注入）
 * - 空段落裁剪（★【...】★ 等中文标签）对英文模板不生效，无害
 */
/** 模板 key → en-US 角色定位（systemRole） */
export const EN_US_ROLE: Partial<Record<string, string>> = {
  'generate_global_config': 'You are a top-tier web novel chief editor with ten years in the industry and a platinum-tier author, skilled at distilling a complete commercial novel configuration from a one-line idea.',
  'infer_novel_config': 'You are a top-tier web novel chief editor and senior reading analyst, skilled at reverse-engineering setting systems from existing works.',
  'infer_novel_config_with_vectors': 'You are a top-tier web novel chief editor and senior reading analyst, skilled at reverse-engineering setting systems from existing works.',
  'premise': 'You are a top-tier web novel planning expert and story architect.',
  'character_dynamics': 'You are a top-tier web novel planning expert and story architect.',
  'world_building': 'You are a top-tier web novel planning expert and story architect.',
  'synopsis': 'You are a top-tier web novel planning expert and story architect.',
  'chapter_blueprint': 'You are an experienced web novel architect skilled at designing precise chapter blueprints.',
  'chapter_blueprint_chunk': 'You are an experienced web novel architect skilled at designing precise chapter blueprints.',
  'infer_single_chapter_blueprint': 'You are a professional web novel structure analyst skilled at extracting structured blueprint information from chapter text.',
  'first_chapter_draft': 'You are a masterful top-tier web novelist with superb prose, skilled at writing compelling commercial web novel chapters that keep readers hooked.',
  'next_chapter_draft': 'You are a masterful top-tier web novelist with superb prose, skilled at writing compelling commercial web novel chapters that keep readers hooked.',
  'refine_chapter': 'You are a deeply skilled literary editor, adept at elevating ordinary drafts into platinum-tier quality.',
  'refine_from_review': 'You are a rigorous novel editor, skilled at precisely repairing specific issues in text without over-rewriting.',
  'consistency_check': 'You are an extremely rigorous, impartial novel quality supervisor editor. You check only objective factual issues and never judge subjective prose quality.',
  'analyze_writing_style': 'You are a senior literary critic and web novel researcher, skilled at precisely capturing an author\'s writing style fingerprint.',
  'generate_chapter_notes': 'You are a professional web novel structure analyst.',
  'update_character_cards': 'You are a rigorous novel character archive manager, skilled at tracking multi-dimensional character state changes.',
  'extract_initial_characters': 'You are a professional novel data structuring expert.',
}

/** 模板 key → en-US 系统约束（systemSuffix） */
export const EN_US_SUFFIX: Partial<Record<string, string>> = {
  'generate_global_config': `【Output Format Restriction】
- Must return in standard JSON format, matching the structure below.

【JSON Field Structure】
{
    "genre": "Main genre (xuanhuan/fairy-cultivation/urban/sci-fi/history/mystery/game/military/fantasy/wuxia/realistic/other)",
    "targetAudience": "Target audience (male-channel/female-channel/general/short-form)",
    "subGenre": "Sub-genre and core tags (e.g., post-apocalyptic wasteland, grinder-protagonist, political intrigue, female-lead revenge)",
    "plotStructure": "Story structure (three_act=three-act / heros_journey=hero's journey / save_the_cat=beat sheet / kishotenketsu=four-act / multi_thread=multi-threaded / freeform=free structure; recommend the best fit for the genre)",
    "narrativePOV": "Narrative POV (third_limited=third-person limited / first_person=first-person / third_omniscient=third-person omniscient / multi_pov=rotating POVs; recommend the best fit for the genre)",
    "coreOutline": "Core outline (no less than 150 characters, including: the protagonist's life-threatening crisis/opening predicament, the core goal to achieve, the ultimate crisis, and the major satisfaction-point rises and falls)",
    "worldSetting": "Unique background setting (physical dimensions, power fault lines, core resource competition mechanics)",
    "goldenFinger": "Core selling point and golden finger system (acquisition method, concrete functions, progression path, side effects/limitations)",
    "protagonistProfile": "Protagonist profile (high-contrast personality flaws, surface disguise tags, core drivers: material goal + deep soul longing)",
    "globalGuidance": "Global writing guidance and core taboos (strictly based on the {{number_of_chapters}}-chapter scale: chapter counts for early/mid/late arcs, specific climax frequencies for small/medium/major beats, forbidden toxic points)",
    "writingStyle": "Style configuration (no less than 100 characters, covering: narrative pacing and scene transition frequency, description density preference, dialogue style and colloquialism, classical/modern/technical vocabulary preference, emotional tone (hot-blooded/bleak/humorous/heavy), signature rhetorical devices and transition techniques. Recommend the style best matching the genre and audience)"
}`,

  'premise': `★【Author's additional guidance for this step (if any — highest priority)】★:
{{step_guidance}}`,
  'character_dynamics': `★【Author's additional guidance for this step (if any — highest priority)】★:
{{step_guidance}}`,
  'world_building': `★【Author's additional guidance for this step (if any — highest priority)】★:
{{step_guidance}}`,
  'synopsis': `★【Author's additional guidance for this step (if any — highest priority)】★:
{{step_guidance}}`,

  'first_chapter_draft': `★【Author's additional guidance for this step (if any — highest priority)】★:
{{user_guidance}}

【Specific Generation Requirements】
- Length and pacing: approximately {{word_number}} characters (the system verifies word count automatically — no need to count manually, trust your sense of pacing). Advance only the core plot specified in 【Chapter Information】 — no filler! Do not pad with redundant exposition or meaningless daily dialogue. Once the chapter goal is achieved, end immediately on a suspense note; never leak future plot.
- Format: output pure text prose only. No Markdown syntax (no * or ** or # etc.). All dialogue must use standard double quotation marks; script-style dialogue is strictly forbidden.
- **Mandatory layout: keep a blank line between paragraphs. Never run multiple paragraphs together without blank lines!**
- Ending rule: leave a strong hook on the final line of the chapter.

【Anti-AI-flavor — the following patterns are strictly forbidden】
- No end-of-paragraph summary sentences (e.g., "he knew this was only the beginning", "the gears of fate began to turn")
- Words like "seemed", "as if", "like" — no more than 3 total per chapter
- Dialogue must distinguish character voices: each character's way of speaking must be recognizable
- No philosophical musings or narrator summaries unrelated to the story at the end`,

  'next_chapter_draft': `★【Author's additional guidance for this step (if any — highest priority)】★:
{{user_guidance}}

【Output Format】
- Length and pacing: approximately {{word_number}} characters (the system verifies word count automatically — no need to count manually, trust your sense of pacing). This chapter advances only the core conflict in 【Chapter Information】 — no filler! End the chapter as soon as the goal is achieved; never extend into later outline content.
- Output pure text prose only! Never start with "Chapter X, text follows".
- Pure text only — no Markdown syntax. All dialogue must use double quotation marks; script-style format is strictly forbidden.
- **Mandatory layout: keep a blank line between paragraphs without exception. Never cram multiple paragraphs into one block!**

【Anti-AI-flavor — the following patterns are strictly forbidden】
- No end-of-paragraph summary sentences (e.g., "he knew this was only the beginning", "the gears of fate began to turn")
- Words like "seemed", "as if", "like" — no more than 3 total per chapter
- Dialogue must distinguish character voices: each character's way of speaking must be recognizable
- No philosophical musings or narrator summaries unrelated to the story at the end`,

  'refine_chapter': `★【Author's additional guidance for this step (if any — highest priority)】★:
{{user_refine_prompt}}

Output the fully refined chapter content directly. Pure text required — no Markdown syntax, no script-style dialogue. 【Strictly】no opening remarks or explanatory text.
**【Mandatory layout baseline】：keep a blank line between paragraphs without exception; never allow long unbroken paragraph blocks.**`,

  'refine_from_review': `★【Author's additional guidance for this step (if any — highest priority)】★:
{{user_refine_prompt}}

Output the repaired full chapter content directly. Pure text required — no script-style format, 【strictly】no opening remarks or explanatory text.
**【Mandatory layout baseline】：keep a blank line between paragraphs without exception; absolutely no continuous text without blank lines.**`,

  'consistency_check': `★【Dimensions the author requires focused review (if any — these must be checked first and in depth)】★:
{{review_focus}}

## Output Format (Markdown Table)

Output the review results strictly as the following Markdown table (no JSON, no code block):

| category | severity | quote | description |
|----------|----------|-------|-------------|
| Plot continuity | pass | | No contradictions with earlier content found |
| Plot plausibility | error | Excerpt of the problematic sentence | Specific issue description |
| Character states | warning | Original sentence | Description of minor inconsistency |

severity values: error=serious contradiction, recommended fix; warning=minor inconsistency, optional fix; pass=dimension passes.
One record per row, covering at least 5 categories (plot continuity, plot plausibility, character states, cross-chapter continuity, foreshadowing integrity). The quote column may be left empty for pass.`,
}

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

【Global Config】(genre, target audience, narrative POV, chapter plan — must be strictly followed; do NOT change POV or genre on your own)
{{novel_config}}

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

  'infer_novel_config': `Reverse-engineer the complete world-building system of this novel from the following content samples, to support continuation writing.

【Existing Content Samples】
{{sample_content}}

---

Return the analysis strictly in the following JSON format:

{
  "novelConfig": {
    "genre": "Main genre (xuanhuan/fairy-cultivation/urban/sci-fi/history/mystery/game/military/fantasy/wuxia/realistic/other)",
    "targetAudience": "Audience (male-channel/female-channel/general)",
    "subGenre": "Sub-genre and tags",
    "plotStructure": "Story structure (three_act/heros_journey/save_the_cat/kishotenketsu/multi_thread/freeform)",
    "narrativePOV": "Narrative POV (third_limited/first_person/third_omniscient/multi_pov)",
    "coreOutline": "Core outline (150+ characters, including main-line goal, core conflict, story direction)",
    "worldSetting": "World background and power system",
    "goldenFinger": "Protagonist's golden finger / core ability system",
    "protagonistProfile": "Protagonist profile (personality, background, core drives)",
    "globalGuidance": "Global writing style and pacing requirements inferred from the existing content",
    "writingStyle": "Writing style (100+ characters, including language style and pacing)"
  },
  "architectureFiles": {
    "premise": "Core story premise text (highly condensed, 50-200 characters, must include a one-line logline and the core conflict)",
    "characters": "Full character map (must be sectioned by character: one paragraph per known major character with 【Character Name】 as the first line, covering identity/background/personality/core motivation/relationship with the protagonist/hidden secrets; end with a 【Conflict Web】 section summarizing inter-character conflicts; no less than 400 characters)",
    "worldbuilding": "World matrix (power system, class structure, key scenes)",
    "synopsis": "Known plot direction analysis (covering completed parts and inferred continuation)"
  },
  "characterCards": [
    {
      "name": "Character name",
      "role": "protagonist/antagonist/supporting/minor",
      "gender": "Gender",
      "age": "Age or stage",
      "appearance": "Appearance description",
      "personality": "Personality traits",
      "background": "Backstory",
      "abilities": "Abilities/skills",
      "motivation": "Core motivation",
      "relationships": "Relationship network",
      "arc": "Known growth arc",
      "notes": "Other notes",
      "currentState": {
        "location": "Last known location",
        "powerLevel": "Current realm/ability level",
        "physicalState": "Current physical state",
        "mentalState": "Current mental state",
        "keyItems": "Key items currently held",
        "recentEvents": "Recent important events",
        "updatedAtChapter": 0
      }
    }
  ]
}

Requirements:
1. characterCards must include only the protagonist and important supporting characters (3-8), skip minor background characters.
2. All fields must be inferred from the content; for fields that cannot be determined, write "（待确认）" (to be confirmed).
3. currentState should reflect the latest content (ending samples), not the initial state.`,

  'infer_novel_config_with_vectors': `Reverse-engineer the complete world-building system of this novel from the precisely extracted key fragments below.

【Chapter 1 Content (opening style reference)】
{{first_chapter}}

【Latest Chapter Content (current progress reference)】
{{latest_chapter}}

【Total Chapters】{{total_chapters}}

【Vector-Retrieved Fragments — World & Power System】
{{sampled_worldview}}

【Vector-Retrieved Fragments — Protagonist & Golden Finger】
{{sampled_protagonist}}

【Vector-Retrieved Fragments — Core Conflict & Antagonists】
{{sampled_conflict}}

【Vector-Retrieved Fragments — Writing Style & Narrative Technique】
{{sampled_style}}

---

Return the analysis strictly in the following JSON format:

{
  "novelConfig": {
    "genre": "Main genre (xuanhuan/fairy-cultivation/urban/sci-fi/history/mystery/game/military/fantasy/wuxia/realistic/other)",
    "targetAudience": "Audience (male-channel/female-channel/general)",
    "subGenre": "Sub-genre and tags",
    "plotStructure": "Story structure (three_act/heros_journey/save_the_cat/kishotenketsu/multi_thread/freeform)",
    "narrativePOV": "Narrative POV (third_limited/first_person/third_omniscient/multi_pov)",
    "coreOutline": "Core outline (150+ characters, including main-line goal, core conflict, story direction)",
    "worldSetting": "World background and power system",
    "goldenFinger": "Protagonist's golden finger / core ability system",
    "protagonistProfile": "Protagonist profile (personality, background, core drives)",
    "globalGuidance": "Global writing style and pacing requirements inferred from the existing content",
    "writingStyle": "Writing style (100+ characters, including language style and pacing)"
  },
  "architectureFiles": {
    "premise": "Core story premise text (highly condensed, 50-200 characters, must include a one-line logline and the core conflict)",
    "characters": "Full character map (must be sectioned by character: one paragraph per known major character with 【Character Name】 as the first line, covering identity/background/personality/core motivation/relationship with the protagonist/hidden secrets; end with a 【Conflict Web】 section summarizing inter-character conflicts; no less than 400 characters)",
    "worldbuilding": "World matrix (power system, class structure, key scenes)",
    "synopsis": "Known plot direction analysis (covering completed parts and inferred continuation)"
  },
  "characterCards": [
    {
      "name": "Character name",
      "role": "protagonist/antagonist/supporting/minor",
      "gender": "Gender",
      "age": "Age or stage",
      "appearance": "Appearance description",
      "personality": "Personality traits",
      "background": "Backstory",
      "abilities": "Abilities/skills",
      "motivation": "Core motivation",
      "relationships": "Relationship network",
      "arc": "Known growth arc",
      "notes": "Other notes",
      "currentState": {
        "location": "Last known location",
        "powerLevel": "Current realm/ability level",
        "physicalState": "Current physical state",
        "mentalState": "Current mental state",
        "keyItems": "Key items currently held",
        "recentEvents": "Recent important events",
        "updatedAtChapter": 0
      }
    }
  ]
}

Requirements:
1. characterCards must include only the protagonist and important supporting characters (3-8), skip minor background characters.
2. All fields must be inferred from the fragments; for fields that cannot be determined, write "（待确认）" (to be confirmed).
3. currentState should reflect the latest content (latest chapter), not the initial state.`,

  'chapter_blueprint': `Based on the 【Full Book Architecture Engine】 we derived earlier, generate the concrete "nanny-level execution outline" for chapters 1 through {{number_of_chapters}}.

【Anti-Drift Core Rules】
- Novel genre: {{genre}}
- Global writing requirements and taboos: {{global_guidance}} (This is the absolute bottom line that must never be crossed!)

【Full Book Architecture Data Pool】
{{novel_architecture}}

【Commercial Web-Novel Pacing Principles】
1. Golden Three Chapters: Chapter 1 immediately throws a "survival/high-pressure dilemma", Chapter 2 activates the golden finger / biggest contrast variable, Chapter 3 completes the first "small face-slap/breakthrough" and leaves a hook.
2. Small climax cycle: strictly follow a "small cycle every 3-5 chapters".
3. No filler or tedious chapters: every chapter must contain "substantive plot movement".
4. Suspense hook mechanism: every chapter must end with a variable that makes readers want to keep turning pages.

【Output Format Rules】
Output every chapter strictly and ONLY in the following Markdown table format (no JSON, no code blocks):

| chapterNumber | title | role | purpose | characters | keyEvents | suspenseHook |
|--------------|-------|------|---------|------------|-----------|-------------|
| 1 | An engaging title | Setup | The one thing the protagonist must solve this chapter | CharacterA, CharacterB | What the protagonist did, what twist they hit, how the golden finger was used. ~100 characters | One sentence on the suspense left at the end |

Requirements:
- role values: Setup, Teaser, Development, Conflict, Climax, Twist, Wrap-up
- keyEvents per chapter: 100-150 characters, extremely dense information.
- characters: separate names with commas.
- Output only the final Markdown table — no pleasantries, no code blocks.

【Output Discipline (violating any of these is unacceptable)】
- Strictly output chapterNumber 1 through {{number_of_chapters}}, one chapter per line; no omissions, no skipped or duplicated numbers.
- Never output chapters outside 1-{{number_of_chapters}}.
- Roles, settings, and golden fingers in keyEvents must come directly from the 【Full Book Architecture Data Pool】; never introduce characters, factions, or new settings that do not exist in the architecture.
- Control total output length: ~1 line per chapter (keyEvents 100-150 characters), ~{{number_of_chapters}} lines total. Do not pad.

★【Author's pacing/style guidance (if any — highest priority)】★:
{{pacing_guidance}}`,

  'chapter_blueprint_chunk': `Based on the 【Full Book Architecture Engine】 and 【Generated Outline Progress】, generate an extremely rigorous "nanny-level execution outline" for the upcoming chapters {{n}} through {{m}}.

【Anti-Drift Core Rules】
- Novel genre: {{genre}}
- Book scale: {{number_of_chapters}} chapters total
- Global writing requirements and taboos: {{global_guidance}} (This is the absolute bottom line that must never be crossed!)

【Full Book Architecture Data Pool】
{{novel_architecture}}

【Previous Plot Progress & Continuity Check】
The following is a condensed view of the previous chapters (to avoid losing track of the main line):
{{chapter_list}}

【This Task: Relay Deduction】
Closely continue the plot from the last chapter above, and rigorously deduce chapters {{n}} through {{m}}.
1. Continuous small climax rule: keep a small climax every 3-5 chapters.
2. Foreshadowing must be paid off or released: if earlier chapters left a crisis, it must be triggered or resolved here.
3. No filler: every chapter must show substantive progress.

【Output Format Rules】
Output every chapter strictly and ONLY in the following Markdown table format (no JSON, no code blocks):

| chapterNumber | title | role | purpose | characters | keyEvents | suspenseHook |
|--------------|-------|------|---------|------------|-----------|-------------|
| {{n}} | An engaging title | Development | The one thing the protagonist must solve this chapter | CharacterA, CharacterB | What concretely happened, how the golden finger worked. ~100 characters | The hook left at the end |

Requirements:
- role values: Setup, Teaser, Development, Conflict, Climax, Twist, Wrap-up
- Stay strictly consistent with the context; no contradictions with previous chapters.
- characters: separate names with commas.
- Output only the final Markdown table — no pleasantries, no code blocks.

【Output Discipline (violating any of these is unacceptable)】
- Output ONLY chapters with chapterNumber from {{n}} to {{m}}, one per line; never output chapters beyond {{m}} (do not leak future plot), no omissions, no skipped or duplicated numbers.
- Roles, settings, and golden fingers in keyEvents must come from the 【Full Book Architecture Data Pool】 or the 【Previous Plot Progress】; never introduce characters, factions, or new settings that do not exist.
- Control total output length: ~1 line per chapter (keyEvents 100-150 characters), ~{{m}}−{{n}}+1 lines total. Do not pad.

★【Author's pacing/style guidance (if any — highest priority)】★:
{{pacing_guidance}}`,

  'infer_single_chapter_blueprint': `Read the following existing chapter content and extract structured blueprint information from it.

【Global Novel Config Summary】
{{novel_config_summary}}

【Chapter Info】
- Chapter number: Ch.{{chapter_number}}
- Split title: {{chapter_title}}

【Chapter Content】
{{chapter_content}}

---

Output this chapter's blueprint strictly in the following JSON format:

{
  "chapterNumber": {{chapter_number}},
  "title": "A precise chapter title distilled from the content (keep the split title if it is already good)",
  "role": "This chapter's role in the book (setup, development, twist, climax, transition, etc.)",
  "purpose": "The core problem the protagonist wants to solve this chapter (one sentence)",
  "characters": ["Names of important characters appearing in this chapter"],
  "keyEvents": "Overview of core events (100-150 characters, including causality and results)",
  "suspenseHook": "The suspense or hook left at the end (one sentence)"
}

Requirements:
1. keyEvents must be extracted from actual chapter content — never fabricate.
2. characters: only major interacting characters (3-5), no minor background characters.
3. role: judged from the narrative function in the text (setup/development/twist/climax/ending/transition, etc.).
4. Output only the JSON, no extra text.`,

  'generate_chapter_notes': `Generate a precise 【Structured Chapter Notes】 for the following chapter.

【Chapter Content】
Ch.{{chapter_number}} {{chapter_title}}
{{chapter_content}}

---

Output strictly in the following Markdown format, without any additional explanation:

# Ch.{{chapter_number}} Notes

## Plot Nodes
(List irreversible key plot progress in this chapter, tagged with [type])
- [Trigger] ...
- [Twist] ...
- [Result] ...

## Character Dynamics
(Table of major characters appearing in this chapter and their changes)
| Character | Change/State this chapter |
|------|-------------|
| Character name | Specific change description |

## New Settings
(World/power-system/rules first appearing or confirmed in this chapter; omit if none)
- ...

## Foreshadowing & Hooks
(Foreshadowing planted this chapter is tagged [Planted], hooks left for readers tagged [Hook]; omit if none)
- [Planted] ...
- [Hook] ...

Strictly follow the format. Be concise: no more than 30 characters per item.`,

  'update_character_cards': `Based on the chapter content, return the latest state of every character whose state changed in this chapter, in Markdown table format.

【Chapter Content (Ch.{{chapter_number}})】
{{chapter_content}}

【Existing Character Cards (basic info)】
{{existing_cards_json}}

---

【Task Requirements】
1. Analyze and extract state changes of existing characters (look them up in the provided character cards) into \`updates\`.
2. Analyze and extract important newly-appearing characters into \`newCharacters\` (exclude passers-by and background characters with no future impact).
3. \`currentState\` field description:
   - location: current location/faction (string)
   - powerLevel: cultivation realm/ability level (string)
   - physicalState: physical state, including injuries/BUFFs/appearance changes (string)
   - mentalState: mental state, current desires/fears/mindset (string)
   - keyItems: key items/resources currently held (string)
   - recentEvents: the most important event this chapter (string, within 50 characters)
   - updatedAtChapter: always {{chapter_number}} (number)
4. \`tags\`: character tags (e.g., "genius youth, avenger, sword cultivator"), comma-separated; write "none" if no new tags.
5. \`motivation\`: the character's current core motivation/desire (update it if it changed or was revealed this chapter; write "none" if unchanged).
6. NEW table additionally requires \`appearance\` (signature appearance features) and \`personality\` (personality traits) — never leave these blank when registering new characters; appearance must be fleshed out from the description in the chapter.

【Output Format (Markdown tables)】
Output strictly in the tables below (no JSON, no code blocks):

### UPDATES (existing characters whose state changed)
| name | location | powerLevel | physicalState | mentalState | keyItems | recentEvents | tags | motivation |
|------|----------|------------|---------------|-------------|----------|-------------|------|------------|
| Character name | Location | Realm | Physical state | Mental state | Items | Events this chapter (≤50 chars) | Tags (comma-separated) | Current core motivation |

### NEW (newly appearing characters)
| name | role | location | powerLevel | physicalState | mentalState | keyItems | recentEvents | tags | motivation | appearance | personality |
|------|------|----------|------------|---------------|-------------|----------|-------------|------|------------|------------|-------------|
| New character | protagonist/antagonist/supporting/minor | Location | Realm | State | Mental | Items | Introduction | Tags | Motivation | Appearance | Personality |

Note: updatedAtChapter is always {{chapter_number}}. Output only existing characters whose state changed; write "none" for unchanged tags/motivation. If no character state changed and no new characters appear, output "No changes".`,

  'extract_initial_characters': `Extract structured information for all important characters from the following character map text.

【Character Map Text】
{{character_dynamics}}

【Novel Genre】
{{genre}}

【Task Requirements】
1. Extract every character explicitly described in the map (protagonist, antagonist, important supporting characters) — do not miss any.
2. Skip background characters or those mentioned only in passing.
3. All fields are extracted from the map. If the map does not explicitly describe appearance, infer a full signature appearance description from the character's identity, background, and personality (never leave appearance blank or write "unknown"). Other minor fields that cannot be determined may be left as empty strings.
4. role is limited to: protagonist, antagonist, supporting, minor.
5. currentState is the character's initial state (at story start); updatedAtChapter is always 0.
6. \`tags\`: a short tag array for the character (e.g., ["genius youth", "avenger"], 2-5 tags, used for tiered display in the character list).

【Output Format (JSON array)】
[
  {
    "name": "Character name",
    "role": "protagonist",
    "gender": "Gender",
    "age": "Age or age range",
    "appearance": "Appearance features",
    "personality": "Personality traits",
    "background": "Backstory",
    "abilities": "Abilities/skills/cultivation",
    "motivation": "Core motivation and desires",
    "relationships": "Relationships with other characters",
    "arc": "Expected character arc/growth trajectory",
    "notes": "Other notes",
    "tags": ["tag1", "tag2"],
    "currentState": {
      "location": "Initial location",
      "powerLevel": "Initial realm/ability level",
      "physicalState": "Initial physical state",
      "mentalState": "Initial mental state",
      "keyItems": "Initially held items",
      "recentEvents": "Background events before the story begins",
      "updatedAtChapter": 0
    }
  }
]

If there are no extractable characters in the map, return an empty array [].`,

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
