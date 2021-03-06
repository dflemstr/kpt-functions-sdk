---
title: "Running Functions"
type: docs
weight: 4
menu:
  main:
    weight: 4
---

After completing the [Development Guide](../develop), you'll have a function that can be run locally using `node`:

```sh
node dist/my_func_run.js --help
```

or as a container:

```sh
docker run gcr.io/kpt-functions-demo/my-func:dev --help
```

In order do something useful with a function, we need to compose a [Pipeline][concept-pipeline] with a
source and a sink function.

This guide covers two approaches to running a pipeline of functions:

- [Using `kpt fn`](#using-kpt-fn)
- [Using `docker run`](#using-docker-run)

You can also use a container-based workflow orchestrator like [Cloud Build][cloud-build], [Tekton][tekton], or [Argo Workflows][argo].

## Using `kpt fn`

`kpt` CLI provides utilities for working with configuration, including running KPT functions.

### Installing `kpt` CLI

Follow [installation instructions][download-kpt] to get the `kpt` CLI.

### Example

First, initialize a git repo if necessary:

```sh
git init
```

Fetch an example configuraton package:

```sh
kpt pkg get https://github.com/GoogleContainerTools/kpt-functions-sdk.git/example-configs example-configs
cd example-configs
git add . && git commit -m 'fetched example-configs'
```

You can run a function imperatively:

```sh
kpt fn run --image gcr.io/kpt-functions/label-namespace . -- label_name=color label_value=orange
```

You should see labels added to `Namespace` configuration files:

```sh
git status
```

Alternatively, you can run a function declaratively:

```sh
cat << EOF > kpt-func.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: my-config
  annotations:
    config.k8s.io/function: |
      container:
        image:  gcr.io/kpt-functions/label-namespace
    config.kubernetes.io/local-config: "true"
data:
  label_name: color
  label_value: orange
EOF
```

You should see the same results as in the previous examples:

```sh
kpt fn run .
git status
```

You can have multiple function declarations in a directory. Let's add a second function:

```sh
cat << EOF > kpt-func2.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: my-config
  annotations:
    config.k8s.io/function: |
      container:
        image:  gcr.io/kpt-functions/validate-rolebinding
    config.kubernetes.io/local-config: "true"
data:
  subject_name: bob@foo-corp.com
EOF
```

`fn run` executes both functions:

```sh
kpt fn run .
```

In this case, `validate-rolebinding` will find policy violations and fail with a non-zero exit code.

Refer to help pages for more details on how to use `kpt fn`

```sh
kpt fn run --help
```

## Using `docker run`

You can run a pipeline of KPT functions using only `docker run`.

### Example 1

Begin by running the function with the `--help` option:

```sh
docker run gcr.io/kpt-functions/label-namespace --help
```

The `label_namespace` function is parameterized with a `functionConfig` of kind `ConfigMap`. It labels
the `Namespace` objects in the input with the given given `label_name` and `label_value`.

Let's explore different ways of invoking this functions.

#### functionConfig from a file

`functionConfig` can be specified as a file:

```sh
cat > /tmp/fc.yaml <<EOF
apiVersion: v1
kind: ConfigMap
data:
  label_name: color
  label_value: orange
metadata:
  name: my-config
EOF
```

For now, let's use a hardcoded input containing two `Namespace` and one `ResourceQuota` objects:

```sh
cat > /tmp/input.yaml <<EOF
apiVersion: v1
kind: List
items:
- apiVersion: v1
  kind: Namespace
  metadata:
    name: audit
    annotations:
      config.kubernetes.io/path: audit/namespace.yaml
      config.kubernetes.io/index: '0'
- apiVersion: v1
  kind: Namespace
  metadata:
    name: shipping-dev
    annotations:
      config.kubernetes.io/path: shipping-dev/namespace.yaml
      config.kubernetes.io/index: '0'
- apiVersion: v1
  kind: ResourceQuota
  metadata:
    name: rq
    namespace: shipping-dev
    annotations:
      config.kubernetes.io/path: shipping-dev/resource-quota.yaml
      config.kubernetes.io/index: '0'
  spec:
    hard:
      cpu: 100m
      memory: 100Mi
      pods: '1'
EOF
```

Running the function, you should see the mutated `List` printed to stdout:

```sh
docker run -i -u $(id -u) -v /tmp:/tmp gcr.io/kpt-functions/label-namespace -i /tmp/input.yaml -f /tmp/fc.yaml
```

#### functionConfig from literal values

`functionConfig` can be any Kubernetes Kind. It's common for functions to use a ConfigMap to
provide a simple list of key/value pairs as parameters. We provide porcelain to make this easier:

```sh
docker run -i gcr.io/kpt-functions/label-namespace -d label_name=color -d label_value=orange < /tmp/input.yaml
```

> **Note:** This causes an error if the function takes another Kind of `functionConfig`.

#### Composing a pipeline

We can use any source and sink function to compose a pipeline. Here, we'll use `read-yaml` and `write-yaml`
functions from the [KPT functions catalog][catalog].

Pull the images:

```sh
docker pull gcr.io/kpt-functions/read-yaml
docker pull gcr.io/kpt-functions/write-yaml
```

You'll also need some example configuration:

```sh
git clone --depth 1 https://github.com/GoogleContainerTools/kpt-functions-sdk.git
cd kpt-functions-sdk/example-configs
```

Finally, let's run the pipeline:

```sh
docker run -i -u $(id -u) -v $(pwd):/source gcr.io/kpt-functions/read-yaml -i /dev/null -d source_dir=/source |
docker run -i gcr.io/kpt-functions/label-namespace -d label_name=color -d label_value=orange |
docker run -i -u $(id -u) -v $(pwd):/sink gcr.io/kpt-functions/write-yaml -o /dev/null -d sink_dir=/sink -d overwrite=true
```

You should see labels added to `Namespace` configuration files:

```sh
git status
```

#### Understanding `docker run` Flags

- `-u`: By default, containers run as a non-privileged user. Privileged actions, like
  filesystem access or calls to the network, require escalated access. Note the example usages of
  `read-yaml`, which include `docker run -u $(id -u)`, running the container with your user ID.
- `-v`: Filesystem access requires mounting your container's filesystem onto your local
  filesystem. For example, the `read-yaml` command includes the following: `-v $(pwd):/source`. This connects
  the container's `/source` directory to the current directory on your filesystem.
- `-i`: This flag keeps STDIN open for use in pipelines.

### Example 2

Functions can be piped to form sophisticated pipelines.

First, grab the `example-configs` directory and pull the container images:

```sh
git clone --depth 1 https://github.com/GoogleContainerTools/kpt-functions-sdk.git
cd kpt-functions-sdk/example-configs

docker pull gcr.io/kpt-functions/read-yaml
docker pull gcr.io/kpt-functions/mutate-psp
docker pull gcr.io/kpt-functions/expand-team-cr
docker pull gcr.io/kpt-functions/validate-rolebinding
docker pull gcr.io/kpt-functions/write-yaml
```

Run these functions:

```sh
docker run -i -u $(id -u) -v $(pwd):/source  gcr.io/kpt-functions/read-yaml -i /dev/null -d source_dir=/source |
docker run -i gcr.io/kpt-functions/mutate-psp |
docker run -i gcr.io/kpt-functions/expand-team-cr |
docker run -i gcr.io/kpt-functions/validate-rolebinding -d subject_name=alice@foo-corp.com |
docker run -i -u $(id -u) -v $(pwd):/sink gcr.io/kpt-functions/write-yaml -o /dev/null -d sink_dir=/sink -d overwrite=true
```

Let's walk through each step:

1. `read-yaml` recursively reads all YAML files from the `foo-corp-configs` directory on the host.
1. `mutate-psp` reads the output of `read-yaml`. This function **transforms** any `PodSecurityPolicy`
   resources by setting the `allowPrivilegeEscalation` field to `false`.
1. `expand-team-cr` similarly operates on the result of the previous function. It looks
   for Kubernetes custom resource of kind `Team`, and **generates** new resources based on that
   (e.g. `Namespaces` and `RoleBindings`).
1. `validate-rolebinding` **validates** that there are no `RoleBindings` with `subject`
   set to `alice@foo-corp.com`. This steps fails with a non-zero exit code if the policy is violated.
1. `write-yaml` writes the result of the pipeline back to the `foo-corp-configs` directory on the host.

Let's see what changes were made to the repo:

```sh
git status
```

You should see the following changes:

1. An updated `podsecuritypolicy_psp.yaml`, mutated by the `mutate-psp` function.
1. The `payments-dev` and `payments-prod` directories, created by `expand-team-cr` function.

## Next Steps

- [Try running other functions in the Catalog][catalog]

[concept-source]: ../concepts#source-function
[concept-pipeline]: ../concepts#pipeline
[catalog]: https://googlecontainertools.github.io/kpt-functions-catalog/
[label-namespace]: https://github.com/GoogleContainerTools/kpt-functions-sdk/tree/master/ts/hello-world/src/label_namespace.ts
[download-kpt]: https://googlecontainertools.github.io/kpt/installation/
[cloud-build]: https://cloud.google.com/cloud-build/
[tekton]: https://cloud.google.com/tekton/
[argo]: https://github.com/argoproj/argo
