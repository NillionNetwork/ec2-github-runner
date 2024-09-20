const aws = require('./aws');
const gh = require('./gh');
const config = require('./config');
const core = require('@actions/core');

function setOutput(label, ec2InstancesId) {
  core.setOutput('label', label);
  core.setOutput('ec2-instances-ids', JSON.stringify(ec2InstancesId));
}

async function start() {
  const label = config.generateUniqueLabel();
  const githubRegistrationToken = await gh.getRegistrationToken();
  const ec2InstancesId = await aws.startEc2Instance(label, githubRegistrationToken);
  setOutput(label, ec2InstancesId);
  await aws.waitForInstancesRunning(ec2InstancesId);
  await gh.waitForRunnerRegistered(label);
}

async function stop() {
  await aws.terminateEc2Instances();
  await gh.removeRunners();
}

(async function () {
  try {
    config.input.mode === 'start' ? await start() : await stop();
  } catch (error) {
    core.error(error);
    core.setFailed(error.message);
  }
})();
