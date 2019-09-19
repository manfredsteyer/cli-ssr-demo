/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import { BuilderContext, BuilderOutput, createBuilder } from '@angular-devkit/architect';
import { runWebpack, webpackWatcher, webpackWatcherRef } from '@angular-devkit/build-webpack';
import { json, normalize } from '@angular-devkit/core';
import { NodeJsSyncHost } from '@angular-devkit/core/node';
import * as path from 'path';
import { Observable, from, of } from 'rxjs';
import { concatMap, map, switchMap, tap, filter, mergeMap } from 'rxjs/operators';
import * as webpack from 'webpack';
import { WebpackConfigOptions } from '../angular-cli-files/models/build-options';
import {
  getAotConfig,
  getCommonConfig,
  getNonAotConfig,
  getServerConfig,
  getStatsConfig,
  getStylesConfig,
} from '../angular-cli-files/models/webpack-configs';
import { ExecutionTransformer } from '../transforms';
import { NormalizedBrowserBuilderSchema, deleteOutputDir } from '../utils';
import { assertCompatibleAngularVersion } from '../utils/version';
import { generateBrowserWebpackConfigFromContext } from '../utils/webpack-browser-config';
import { Schema as ServerBuilderOptions } from './schema';
import { buildWebpackBrowser } from '../browser';
import { ConvertActionBindingResult } from '@angular/compiler/src/compiler_util/expression_converter';

// If success is true, outputPath should be set.
export type ServerBuilderOutput = json.JsonObject & BuilderOutput & {
  outputPath?: string;
};

export { ServerBuilderOptions };

function invalidate(): Observable<null> {
  if (webpackWatcherRef.webpackWatcher) {
    console.debug('invalidate');
    webpackWatcherRef.webpackWatcher.invalidate();
  }
  else {
    throw new Error('connot invalidate because webpackWatcher is null');
  }
  return of();
}

export function execute(
  options: ServerBuilderOptions,
  context: BuilderContext,
  transforms: {
    webpackConfiguration?: ExecutionTransformer<webpack.Configuration>;
  } = {},
): Observable<ServerBuilderOutput> {

  return buildWebpackBrowser(options as any, context).pipe(
    tap(_ => console.debug('browser builder: done')),
    // Only start the server builder once; after further changes tell its
    // webpack instance which runs in watch mode to invalidate the build
    mergeMap(_ => !webpackWatcherRef.webpackWatcher ? _execute(options, context) : invalidate()),
    tap(_ => console.debug('server builder: done'))
  );

  // return _execute(options, context, transforms);
}

export function _execute(
  options: ServerBuilderOptions,
  context: BuilderContext,
  transforms: {
    webpackConfiguration?: ExecutionTransformer<webpack.Configuration>;
  } = {},
): Observable<ServerBuilderOutput> {
  const host = new NodeJsSyncHost();
  const root = context.workspaceRoot;

  // Check Angular version.
  assertCompatibleAngularVersion(context.workspaceRoot, context.logger);

  return from(buildServerWebpackConfig(options, context)).pipe(
    concatMap(async v => transforms.webpackConfiguration ? transforms.webpackConfiguration(v) : v),
    concatMap(v => {
      if (options.deleteOutputPath) {
        return deleteOutputDir(normalize(root), normalize(options.outputPath), host).pipe(
          map(() => v),
        );
      } else {
        return of(v);
      }
    }),
    concatMap(webpackConfig => runWebpack(webpackConfig, context)),
    map(output => {
      if (output.success === false) {
        return output as ServerBuilderOutput;
      }

      return {
        ...output,
        outputPath: path.resolve(root, options.outputPath),
      } as ServerBuilderOutput;
    }),
  );
}

export default createBuilder<json.JsonObject & ServerBuilderOptions, ServerBuilderOutput>(
  execute,
);

function getCompilerConfig(wco: WebpackConfigOptions) {
  if (wco.buildOptions.main || wco.buildOptions.polyfills) {
    return wco.buildOptions.aot ? getAotConfig(wco) : getNonAotConfig(wco);
  }

  return {};
}

async function buildServerWebpackConfig(
  options: ServerBuilderOptions,
  context: BuilderContext,
) {
  const { config } = await generateBrowserWebpackConfigFromContext(
    {
      ...options,
      buildOptimizer: false,
      aot: true,
      platform: 'server',
    } as NormalizedBrowserBuilderSchema,
    context,
    wco => [
      getCommonConfig(wco),
      getServerConfig(wco),
      getStylesConfig(wco),
      getStatsConfig(wco),
      getCompilerConfig(wco),
    ],
  );

  // // HAK
  const result = config[0];
  result.watchOptions = {
    ...result.watchOptions,
    ignored: /./,
  }
  return result;
}
