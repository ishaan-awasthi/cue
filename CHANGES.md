# Practice Mode — Code Changes

---

## `packages/backend/main.py`

### Added: Pydantic models (lines 433–450)
```python
class PracticeAnalyzeRequest(BaseModel):
    transcript: str
    words_per_minute: float = 0.0
    filler_word_count: int = 0
    duration_seconds: float = 0.0

class PracticeNudge(BaseModel):
    trigger: str   # "filler_word_rate" | "words_per_minute"
    text: str
    value: float

class PracticeAnalyzeResponse(BaseModel):
    score: float   # 0–100
    nudges: list[PracticeNudge]
    filler_words_found: list[str]
    wpm: float
```

### Added: Filler word constants + `_count_fillers()` (lines 453–476)
```python
PRACTICE_FILLER_UNIGRAMS = {"uh", "um", "hmm", "er", "erm", "like", "so", "basically", "literally", "actually"}
PRACTICE_FILLER_BIGRAMS  = ["you know", "i mean", "kind of", "sort of", "you see"]

def _count_fillers(transcript: str) -> tuple[int, list[str]]:
    # 1. Scan bigrams with \b word-boundary regex, replace matches with " _ "
    # 2. Then split and scan single words
    # Returns (total_count, unique_list)
```
Bigrams are scanned first and replaced before the word split — prevents `"you know"` matching both the bigram and `"you"` / `"know"` individually.

### Added: `POST /practice/analyze` (lines 479–533)
```python
@app.post("/practice/analyze", response_model=PracticeAnalyzeResponse)
async def practice_analyze(body: PracticeAnalyzeRequest):
```

Scoring logic:
- Base score: **80**
- WPM 110–160 → **+10**; WPM < 80 or > 200 → **-15**
- Filler rate < 1/min → **+10**; filler rate > 5/min → **-15**
- Clamped to 0–100

Nudge thresholds:
- Filler rate > **3/min** → `"filler_word_rate"` nudge
- WPM < **100** → `"words_per_minute"` (too slow)
- WPM > **180** → `"words_per_minute"` (too fast)

Client's `filler_word_count` is accepted but always **overridden** by the backend recount from transcript if the client sends 0.

---

## `packages/web/lib/api.ts`

### Added: Types + fetch wrapper (lines 165–191)
```typescript
export interface PracticeNudge   { trigger: string; text: string; value: number; }
export interface PracticeAnalyzeResult { score: number; nudges: PracticeNudge[]; filler_words_found: string[]; wpm: number; }

export async function analyzePracticeDrill(opts: {
  transcript: string;
  words_per_minute: number;
  filler_word_count: number;
  duration_seconds: number;
}): Promise<PracticeAnalyzeResult>
// POST /practice/analyze — throws on non-2xx
```

---

## `packages/web/app/app/practice/page.tsx`

Full rewrite. Previous file was a static placeholder. New file is ~1050 lines.

### Types
```typescript
interface SpeakingDrill { type:"speaking"; id; title; description; prompt; durationSeconds; tip; }
interface QuizDrill     { type:"quiz";     id; title; description; question; options; correctIndex; explanation; }
type Drill = SpeakingDrill | QuizDrill;
```

### `countFillers(transcript)` — mirrors backend exactly
- Bigrams replaced via `/bigram\s+words/g` regex before word split
- Single-word set identical to `PRACTICE_FILLER_UNIGRAMS`
- Returns `{ count, found[] }`

### `useSpeechRecorder()` hook
- Wraps browser `SpeechRecognition` / `webkitSpeechRecognition`
- `continuous: true`, `interimResults: true`, `lang: "en-US"`
- Accumulates final results into `finalTranscript` ref; interim results shown live
- `stop()` computes `wordCount`, `fillerCount`, `durationSeconds` and transitions to `"done"` state
- `reset()` aborts recognition and clears all state

### `SpeakingLesson` component
- `useEffect` on `status === "recording"` → sets `setTimeout(stop, durationSeconds * 1000)` for auto-stop
- `useEffect` on `status === "done"` → calls `analyzePracticeDrill()`, falls back to local score formula `80 - fillerCount*5 + (wpmInRange ? 10 : 0)` if fetch fails
- Renders: tip card → prompt card → progress bar with countdown → live transcript → results (ScoreRing + nudges + filler chips + transcript)

### `ScoreRing` component
- SVG circle with `strokeDasharray={score} ${100-score}` for the filled arc
- Color: `text-aqua` ≥ 80, `text-gray-300` ≥ 60, `text-gray-500` < 60

### `QuizLesson` component
- `selected` state drives answer reveal; `disabled` on all buttons after first pick
- Correct option gets `border-green-500/60 bg-green-500/10`, wrong pick gets `border-red-500/60 bg-red-500/10`
- Scores 100 if correct, 60 if wrong

### Page state machine (`type View = "pick-session" | "path" | "lesson" | "complete"`)
- **pick-session**: loads sessions via `listSessions()`; selecting a session calls `getSessionReport()` and passes `areas_to_improve` + `suggested_drills` to `buildDrillsFromReport()`; all drills unlocked
- **path**: progress bar = `completedCount / totalDrills * 100`; every drill card clickable regardless of completion state; completed drills show score inline
- **lesson**: renders `SpeakingLesson` or `QuizLesson` based on `drill.type`; `onComplete(score)` writes to `completedScores[drill.id]` and transitions to `"complete"`
- **complete**: `LessonComplete` with "Next lesson" if `currentDrillIndex < drills.length - 1`

### Default drills (`DEMO_DRILLS`)
| id | type | title | durationSeconds |
|----|------|-------|----------------|
| d-1 | speaking | The 60-second hook | 60 |
| d-2 | quiz | Filler word awareness | — |
| d-3 | speaking | Vary your pace | 90 |
| d-4 | quiz | Ideal speaking pace | — |
| d-5 | speaking | Handle a tough question | 45 |
