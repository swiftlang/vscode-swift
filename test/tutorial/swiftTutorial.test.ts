import * as vscode from 'vscode';
import { expect } from 'chai';
import { SwiftTutorial } from '../../src/tutorial/swiftTutorial';
import * as sinon from 'sinon';
import * as fs from 'fs';
import * as path from 'path';

describe('SwiftTutorial', () => {
    let context: vscode.ExtensionContext;
    let tutorial: SwiftTutorial;

    beforeEach(() => {
        context = {
            subscriptions: [],
            workspaceState: {
                get: sinon.stub().returns({}),
                update: sinon.stub().resolves()
            }
        } as unknown as vscode.ExtensionContext;
        tutorial = SwiftTutorial.getInstance(context);
    });

    afterEach(() => {
        sinon.restore();
    });

    describe('showTutorial', () => {
        it('should show tutorial walkthrough', async () => {
            const showInfoStub = sinon.stub(vscode.window, 'showInformationMessage');
            const executeCommandStub = sinon.stub(vscode.commands, 'executeCommand');

            await tutorial.showTutorial();

            expect(showInfoStub.calledOnce).to.be.true;
            expect(executeCommandStub.calledWith('workbench.action.walkthroughs.open', 'swift-tutorial')).to.be.true;
        });
    });

    describe('createSampleProject', () => {
        it('should create tutorial project with correct structure', async () => {
            const workspaceFolder = { uri: vscode.Uri.file('/test'), index: 0 };
            sinon.stub(vscode.workspace, 'workspaceFolders').value([workspaceFolder]);
            
            const mkdirSpy = sinon.spy(fs, 'mkdirSync');
            const writeFileSpy = sinon.spy(fs, 'writeFileSync');
            const executeCommandStub = sinon.stub(vscode.commands, 'executeCommand');

            await tutorial.createSampleProject();

            expect(mkdirSpy.called).to.be.true;
            expect(writeFileSpy.called).to.be.true;
            expect(executeCommandStub.calledWith('vscode.openFolder')).to.be.true;
        });

        it('should throw error when no workspace folder exists', async () => {
            sinon.stub(vscode.workspace, 'workspaceFolders').value(undefined);

            try {
                await tutorial.createSampleProject();
                expect.fail('Should have thrown an error');
            } catch (error: any) {
                expect(error.message).to.equal('No workspace folder found');
            }
        });
    });

    describe('tutorial state management', () => {
        it('should track completed steps', () => {
            const stepId = 'test-step';
            
            expect(tutorial.isStepCompleted(stepId)).to.be.false;
            
            tutorial.markStepCompleted(stepId);
            expect(tutorial.isStepCompleted(stepId)).to.be.true;
        });

        it('should save state to workspace', async () => {
            const stepId = 'test-step';
            tutorial.markStepCompleted(stepId);
            await tutorial.saveTutorialState();

            const updateStub = context.workspaceState.update as sinon.SinonStub;
            expect(updateStub.calledOnce).to.be.true;
        });
    });
}); 