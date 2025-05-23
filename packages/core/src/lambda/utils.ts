/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as nls from 'vscode-nls'
const localize = nls.loadMessageBundle()

import xml2js = require('xml2js')
import { Lambda } from 'aws-sdk'
import * as vscode from 'vscode'
import { CloudFormationClient, StackSummary } from '../shared/clients/cloudFormation'
import { LambdaClient } from '../shared/clients/lambdaClient'
import { getFamily, getNodeMajorVersion, RuntimeFamily } from './models/samLambdaRuntime'
import { getLogger } from '../shared/logger/logger'
import { HttpResourceFetcher } from '../shared/resourcefetcher/httpResourceFetcher'
import { FileResourceFetcher } from '../shared/resourcefetcher/fileResourceFetcher'
import { sampleRequestManifestPath } from './constants'
import globals from '../shared/extensionGlobals'

export async function* listCloudFormationStacks(client: CloudFormationClient): AsyncIterableIterator<StackSummary> {
    // TODO: this 'loading' message needs to go under each regional entry
    // in the explorer, and be removed when that region's query completes
    const status = vscode.window.setStatusBarMessage(
        localize('AWS.message.statusBar.loading.cloudFormation', 'Loading CloudFormation Stacks...')
    )

    try {
        yield* client.listStacks()
    } finally {
        status.dispose()
    }
}

export async function* listLambdaFunctions(client: LambdaClient): AsyncIterableIterator<Lambda.FunctionConfiguration> {
    const status = vscode.window.setStatusBarMessage(
        localize('AWS.message.statusBar.loading.lambda', 'Loading Lambdas...')
    )

    try {
        yield* client.listFunctions()
    } finally {
        if (status) {
            status.dispose()
        }
    }
}

/**
 * Returns filename and function name corresponding to a Lambda.FunctionConfiguration
 * Only works for supported languages (Python/JS)
 * @param configuration Lambda configuration object from getFunction
 */
export function getLambdaDetails(configuration: Lambda.FunctionConfiguration): {
    fileName: string
    functionName: string
} {
    let runtimeExtension: string
    switch (getFamily(configuration.Runtime!)) {
        case RuntimeFamily.Python:
            runtimeExtension = 'py'
            break
        case RuntimeFamily.NodeJS: {
            const nodeVersion = getNodeMajorVersion(configuration.Runtime)
            if (nodeVersion && nodeVersion >= 18) {
                // node18+ defaults to using the .mjs extension
                runtimeExtension = 'mjs'
            } else {
                runtimeExtension = 'js'
            }
            break
        }
        default:
            throw new Error(`Toolkit does not currently support imports for runtime: ${configuration.Runtime}`)
    }

    const handlerArr = configuration.Handler!.split('.')

    return {
        fileName: `${handlerArr.slice(0, handlerArr.length - 1).join('.')}.${runtimeExtension}`,
        functionName: handlerArr[handlerArr.length - 1]!,
    }
}

export interface SampleRequest {
    name: string | undefined
    filename: string | undefined
}

interface SampleRequestManifest {
    requests: {
        request: SampleRequest[]
    }
}

export async function getSampleLambdaPayloads(): Promise<SampleRequest[]> {
    const logger = getLogger()
    const sampleInput = await getSampleRequestManifest()

    if (!sampleInput) {
        throw new Error('Unable to retrieve Sample Request manifest')
    }

    logger.debug(`Loaded: ${sampleInput}`)

    const inputs: SampleRequest[] = []

    xml2js.parseString(sampleInput, { explicitArray: false }, (err: Error | null, result: SampleRequestManifest) => {
        if (err) {
            return
        }

        inputs.push(...result.requests.request)
    })

    return inputs
}

async function getSampleRequestManifest(): Promise<string | undefined> {
    const httpResp = await new HttpResourceFetcher(sampleRequestManifestPath, { showUrl: true }).get()
    if (!httpResp) {
        const fileResp = new FileResourceFetcher(globals.manifestPaths.lambdaSampleRequests)
        return fileResp.get()
    }
    return httpResp.text()
}
