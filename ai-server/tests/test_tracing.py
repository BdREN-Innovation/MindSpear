from app.config import Settings
from app.tracing import Tracer


def test_tracing_is_off_without_both_keys():
    for keys in ({}, {"langfuse_public_key": "pk-lf-x"}, {"langfuse_secret_key": "sk-lf-x"}):
        tracer = Tracer(Settings(_env_file=None, **keys))
        assert not tracer.enabled
        assert tracer.run_config("generate quiz", user_id="7", tags=["quiz"], metadata={}) == {"run_name": "generate quiz"}
        tracer.shutdown()  # a no-op
