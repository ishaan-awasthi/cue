from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Supabase
    SUPABASE_URL: str
    SUPABASE_KEY: str

    # Deepgram
    DEEPGRAM_API_KEY: str

    # Deepgram TTS voice model (Aura range)
    DEEPGRAM_TTS_MODEL: str = "aura-asteria-en"

    # OpenAI
    OPENAI_API_KEY: str

    # Coaching thresholds
    NUDGE_INTERVAL_SECONDS: int = 30
    ATTENTION_THRESHOLD: float = 0.6
    FILLER_WORD_RATE_THRESHOLD: float = 3.0

    # Fluency model
    FLUENCY_MODEL_PATH: str = "./models/fluency-model"

    # Q&A pipeline
    QA_MATCH_THRESHOLD: float = 0.75
    QA_SILENCE_TIMEOUT_SECONDS: int = 4


settings = Settings()
