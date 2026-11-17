#!/usr/bin/env sh
# Runs a k6 script in a container, sending the results to the monitoring Prometheus.
#
#   load-tests/run.sh <script under load-tests/k6> [k6 options...]
#   load-tests/run.sh smoke/health.js
#   PARTICIPANTS=100 load-tests/run.sh live/quiz-session.js
#   load-tests/run.sh api/dashboard.js --duration 3m
#   ENV_FILE=.env.server PARTICIPANTS=300 load-tests/run.sh live/quiz-session.js
#
# Settings come from load-tests/.env, or the file ENV_FILE names (git-ignored; templates:
# load-tests/.env.example for the local stack, .env.server.example for dev.mindspear.app).
# A setting given on the command line wins over the file. Every run gets a testid tag
# (TESTID to choose it), which is how the k6 dashboard in Grafana tells runs apart; the
# end-of-run summary is also written to load-tests/results/<testid>.json.
set -eu

cd "$(dirname "$0")"
script=${1:?usage: run.sh <k6/area/scenario.js> [k6 options...]}
shift
[ -f "k6/$script" ] || { echo "run.sh: no such script: load-tests/k6/$script" >&2; exit 1; }

# KEY=value lines; a variable already set (on the command line) is kept.
env_file=${ENV_FILE:-.env}
if [ -f "$env_file" ]; then
	while IFS= read -r line || [ -n "$line" ]; do
		case $line in '' | '#'*) continue ;; esac
		key=${line%%=*}
		eval "already=\${$key+x}"
		[ -n "$already" ] || export "$key=${line#*=}"
	done <"$env_file"
elif [ -n "${ENV_FILE:-}" ]; then
	echo "run.sh: no such settings file: load-tests/$env_file" >&2
	exit 1
fi

testid=${TESTID:-$(basename "$script" .js)-$(date +%Y%m%d-%H%M%S)}
K6_IMAGE=${K6_IMAGE:-grafana/k6:1.0.0}
# Set but empty (PROM_WRITE_URL= load-tests/run.sh ...): run without sending results to Prometheus.
PROM_WRITE_URL=${PROM_WRITE_URL-http://127.0.0.1:9090/api/v1/write}
# k6 keeps every virtual user in memory (a few MB each with a websocket): the cap stops a
# very large run from starving this machine; k6 is then killed instead, and says so.
K6_MEMORY=${K6_MEMORY:-3g}
mkdir -p results

# Pass through the test settings that are set, plus anything named K6_*.
env_args=""
for name in BASE_URL AI_URL REVERB_URL REVERB_KEY PRODUCT PARTICIPANTS QUESTIONS JOIN_RATE ANSWER_SECONDS REVEAL_SECONDS \
	RATE DURATION \
	$(env | sed -n 's/^\(K6_[A-Za-z0-9_]*\)=.*/\1/p'); do
	eval "value=\${$name:-}"
	[ -n "$value" ] && env_args="$env_args -e $name"
done

# Check that Prometheus can take the results before starting, so a long run is not wasted.
# An empty write answers 204 (or 400) when the remote-write receiver is on.
output_args=""
if [ -n "$PROM_WRITE_URL" ]; then
	code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -X POST "$PROM_WRITE_URL" || true)
	case $code in
	204 | 400) ;;
	404 | 405)
		echo "run.sh: Prometheus at $PROM_WRITE_URL does not accept results: it needs --web.enable-remote-write-receiver (as in monitoring/docker-compose.yml)." >&2
		exit 1
		;;
	*)
		echo "run.sh: cannot reach Prometheus at $PROM_WRITE_URL (HTTP ${code:-none})." >&2
		echo "  For the server, open the SSH tunnel first:  ssh -N -L 19090:127.0.0.1:9090 user@server_ip" >&2
		echo "  To run without sending results to Grafana:  PROM_WRITE_URL= load-tests/run.sh $script" >&2
		exit 1
		;;
	esac
	output_args="-o experimental-prometheus-rw"
fi

echo "k6: $script against ${BASE_URL:-http://127.0.0.1:8000}  testid=$testid  results -> ${PROM_WRITE_URL:-(not sent)} and load-tests/results/$testid.json"
# --network host: the app and Prometheus are reached on 127.0.0.1. The user id keeps the
# results file owned by you, not root.
# shellcheck disable=SC2086
exec docker run --rm -i --network host --user "$(id -u):$(id -g)" --memory "$K6_MEMORY" \
	-v "$PWD/k6:/scripts:ro" \
	-v "$PWD/results:/results" \
	$env_args \
	-e K6_PROMETHEUS_RW_SERVER_URL="$PROM_WRITE_URL" \
	-e K6_PROMETHEUS_RW_TREND_STATS="p(95),p(99),min,max,avg" \
	"$K6_IMAGE" run \
	$output_args \
	--tag "testid=$testid" \
	--summary-export "/results/$testid.json" \
	"$@" \
	"/scripts/$script"
