#!/bin/bash
# Copyright 2019 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# shellcheck disable=SC1091
. demo-magic/demo-magic.sh

EXAMPLE_CONFIGS="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"/../../example-configs
# Unused variables left for configuring demo-magic
# shellcheck disable=SC2034
PROMPT_TIMEOUT=8
# shellcheck disable=SC2034
TAG=demo
# shellcheck disable=SC2034
NO_WAIT=true
# Disable interative "less" behavior for e.g. git diff
export GIT_PAGER=

cd "$(mktemp -d)" || exit
git init

stty rows 80 cols 15

export PKG=git@github.com:GoogleContainerTools/kpt-functions-sdk.git/example-configs

# start demo
clear

p "# Fetch configs"
p "kpt pkg get ${PKG} example-configs"
cp -r "${EXAMPLE_CONFIGS}" .
pe "git add . && git commit -m 'fetched example-configs'"

clear

p "# Generate configs"
pe "kpt fn run --image gcr.io/kpt-functions/expand-team-cr ."
pe "git status -u"
wait

git clean -fd
clear

p "# Transform configs"
pe "kpt fn run --image gcr.io/kpt-functions/mutate-psp ."
pe "git diff"
wait

git reset HEAD --hard
clear

p "# Validate configs"
pe "kpt fn run --image gcr.io/kpt-functions/validate-rolebinding . -- subject_name=bob@foo-corp.com"
wait

clear

p "# Compose a pipeline of functions"
pe "kpt fn source . |
  kpt fn run --image gcr.io/kpt-functions/expand-team-cr |
  kpt fn run --image gcr.io/kpt-functions/mutate-psp |
  kpt fn run --image gcr.io/kpt-functions/validate-rolebinding -- subject_name=alice@foo-corp.com |
  kpt fn sink ."
pe "git status -u"
wait

clear

p "# Swap out sources and sinks"
p "kubectl get rolebinding --all-namespaces -o yaml |
  kpt fn run --image gcr.io/kpt-functions/validate-rolebinding -- subject_name=bob@foo-corp.com"
cat <<EOF
MultiConfigErrors: Found RoleBindings with banned subjects

[1] KubernetesObjectError: Object has banned subject
path: No path annotation
apiVersion: "rbac.authorization.k8s.io/v1"
kind: "RoleBinding"
metadata.namespace: "kube-public"
metadata.name: "system:controller:bootstrap-signer"

[2] KubernetesObjectError: Object has banned subject
path: No path annotation
apiVersion: "rbac.authorization.k8s.io/v1"
kind: "RoleBinding"
metadata.namespace: "kube-system"
metadata.name: "system:controller:bootstrap-signer"
EOF
wait

wait
