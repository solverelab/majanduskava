import uuid
from datetime import datetime
from sqlalchemy import create_engine, Column, String, Boolean, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import declarative_base, sessionmaker

SQLALCHEMY_DATABASE_URL = "postgresql://solvere_user:Solvere2026!@localhost:5432/solvere_db"

db_engine = create_engine(SQLALCHEMY_DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=db_engine)
Base = declarative_base()


class EvaluationLog(Base):
    __tablename__ = "evaluation_logs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    evaluated_at = Column(DateTime, default=datetime.utcnow)
    module = Column(String, default="korteriuhistu")
    evaluation_date = Column(String)
    is_valid = Column(Boolean)
    request_payload = Column(JSONB)
    response_payload = Column(JSONB)


Base.metadata.create_all(bind=db_engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()