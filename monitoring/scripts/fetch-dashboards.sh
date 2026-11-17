#!/usr/bin/env sh
# Downloads the community dashboards from grafana.com into grafana/dashboards/ and points them at
# the provisioned datasource (uid "prometheus"). The JSON is committed, so Grafana never fetches
# anything at runtime and every upgrade is a reviewable diff.
#
#   monitoring/scripts/fetch-dashboards.sh     # needs curl and jq; then review `git diff` and commit
#
# To add one: append a line to DASHBOARDS ("<grafana.com id> <folder>/<file>.json"). The folder
# becomes the Grafana folder.
set -eu

DASHBOARDS='
1860  infrastructure/node-exporter-full.json
14282 infrastructure/docker-containers.json
9628  datastores/postgresql.json
763   datastores/redis.json
19665 load-tests/k6-prometheus.json
'

for tool in curl jq; do
	command -v "$tool" >/dev/null 2>&1 || { echo "fetch-dashboards: $tool is required" >&2; exit 1; }
done

# The folder may not exist yet on a fresh checkout.
mkdir -p "$(dirname "$0")/../grafana/dashboards"
cd "$(dirname "$0")/../grafana/dashboards"
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT

echo "$DASHBOARDS" | while read -r id file; do
	[ -n "$id" ] || continue
	curl -fsSL "https://grafana.com/api/dashboards/$id/revisions/latest/download" -o "$tmp"
	mkdir -p "$(dirname "$file")"
	# An exported dashboard names its datasource as an input ("${DS_PROMETHEUS}", "${DS_PROM}", ...),
	# which file provisioning does not resolve: replace every Prometheus input with the uid.
	# Dashboards that pick the datasource with a variable instead (1860) have no inputs and stay
	# as they are. The numeric id is dropped so Grafana assigns its own; the uid is kept, so a
	# re-fetch updates the dashboard in place.
	jq --indent 2 '
		[.__inputs[]? | select(.pluginId == "prometheus") | .name] as $inputs
		| walk(if type == "string"
			then reduce $inputs[] as $name (.; gsub("\\$\\{" + $name + "\\}"; "prometheus"))
			else . end)
		| del(.__inputs, .__elements)
		| .id = null
	' "$tmp" >"$file"
	echo "$id -> $file ($(jq -r .title "$file"))"
done
