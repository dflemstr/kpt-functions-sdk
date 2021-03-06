/**
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { KubeConfig } from '@kubernetes/client-node';
import { Context } from '@kubernetes/client-node/dist/config_types';
import { question } from 'cli-interact';
import { mkdtempSync, unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { resolve, delimiter } from 'path';
import * as request from 'request-promise';
import * as format from '../utils/format';
import { log } from '../utils/log';
import * as validator from '../utils/validator';
import { spawnSync } from 'child_process';
import { CLI_PACKAGE } from '../paths';
import { warn } from '../utils/format';

export async function typeCreate(packageDir: string) {
  const desc = 'Generating types from OpenAPI spec.';
  log(format.startMarker(desc));
  // url for default swagger.json openAPI type definitions
  let url = `https://raw.githubusercontent.com/kubernetes-sigs/kustomize/master/kyaml/openapi/kubernetesapi/swagger.json`;
  // Get the kubeconfig context the user wants to use.
  const kc = new KubeConfig();
  kc.loadFromDefault();
  const contexts = kc.contexts;
  if (contexts.length != 0) {
    const currentContext = kc.currentContext;
    const contextIdx = chooseContext(contexts, currentContext);
    const useContext = contexts[contextIdx];
    const cluster = kc.clusters.find(c => c.name === useContext.cluster);
    if (!cluster) {
      throw new Error('Cluster for specified context not found.');
    }
    kc.setCurrentContext(useContext.name);
    // set the url to cluster openAPI if cluster exists
    url = `${cluster.server}/openapi/v2`;
  } else {
    log(
      warn(
        'No contexts found in kubeconfig file. Using default openAPI type definitions.'
      )
    );
  }
  // Download the swagger file from the url.
  const opts: request.Options = {
    url,
  };
  kc.applyToRequest(opts);
  const out = await request.get(opts);
  const tmp = mkdtempSync(resolve(tmpdir(), 'kpt-init'));
  const swaggerFile = resolve(tmp, 'swagger.json');
  writeFileSync(swaggerFile, out);

  // Run typegen binary.
  const typegenOutDir = resolve(packageDir, 'src', 'gen');
  const typegen = spawnSync('typegen', [swaggerFile, typegenOutDir], {
    env: {
      PATH: `${CLI_PACKAGE.binDir}${delimiter}${process.env.PATH}`,
    },
    stdio: 'inherit',
  });
  unlinkSync(swaggerFile);
  if (typegen.status !== 0) {
    let msg = 'Failed to run typegen';
    if (typegen.error) {
      msg = `${msg}: ${typegen.error}`;
    }
    throw new Error(msg);
  }

  log(`Generated ${typegenOutDir}`);

  log(format.finishMarker(desc));
}

function chooseContext(contexts: Context[], currentContext: string): number {
  const defaultContext =
    contexts.findIndex(c => c.name === currentContext) || 0;
  log('Contexts:\n');
  contexts.forEach((c, idx) => {
    if (c.name === currentContext) {
      // Will match no contexts if current context is not set.
      log(`${idx}) * ${c.name}`);
    } else {
      log(`${idx}) ${c.name}`);
    }
  });
  log();

  const context = validator.getValidString(
    () =>
      question(
        `> What is the kubeconfig context in which to create types (${defaultContext})? `
      ),
    validator.isEmptyOrMaxInt(contexts.length - 1),
    defaultContext.toString()
  );

  log(`Using kubeconfig context "${context}".\n`);

  return Number(context);
}
