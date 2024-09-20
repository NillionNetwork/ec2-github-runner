const AWS = require('aws-sdk');
const core = require('@actions/core');
const config = require('./config');

// User data scripts are run as the root user
function buildUserDataScript(githubRegistrationToken, label, idx) {
  if (config.input.runnerHomeDir) {
    // If runner home directory is specified, we expect the actions-runner software (and dependencies)
    // to be pre-installed in the AMI, so we simply cd into that directory and then start the runner
    return `#!/bin/bash
cd "${config.input.runnerHomeDir}"
echo "${config.input.preRunnerScript}" > pre-runner-script.sh
source pre-runner-script.sh
export RUNNER_ALLOW_RUNASROOT=1

for idx in {1..${config.input.runnersPerMachine}}; do
    cp -r ${config.input.runnerHomeDir} actions-runner-$idx
    cd actions-runner-$idx
    ./config.sh --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label} --name "$(hostname)-runner-$idx"
    ./run.sh &
    cd ..
done
`;
  } else {
    return `#!/bin/bash
mkdir actions-runner && cd actions-runner
echo "${config.input.preRunnerScript}" > pre-runner-script.sh
source pre-runner-script.sh
case $(uname -m) in aarch64) ARCH="arm64" ;; amd64|x86_64) ARCH="x64" ;; esac && export RUNNER_ARCH=\${ARCH}
curl -O -L https://github.com/actions/runner/releases/download/v2.313.0/actions-runner-linux-\${RUNNER_ARCH}-2.313.0.tar.gz
tar xzf ./actions-runner-linux-\${RUNNER_ARCH}-2.313.0.tar.gz
cd ..
export RUNNER_ALLOW_RUNASROOT=1

for idx in {1..${config.input.runnersPerMachine}}; do
    cp -r actions-runner actions-runner-$idx
    cd actions-runner-$idx
    ./config.sh --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label} --name "$(hostname)-runner-$idx"
    ./run.sh &
    cd ..
done
`;

  }
}

async function startEc2Instance(label, githubRegistrationToken) {
  const ec2 = new AWS.EC2();

  const userData = buildUserDataScript(githubRegistrationToken, label);

  const params = {
    ImageId: config.input.ec2ImageId,
    InstanceType: config.input.ec2InstanceType,
    MinCount: 1,
    MaxCount: 1,
    UserData: Buffer.from(userData).toString('base64'),
    SubnetId: config.input.subnetId,
    SecurityGroupIds: [config.input.securityGroupId],
    IamInstanceProfile: { Name: config.input.iamRoleName },
    TagSpecifications: config.tagSpecifications,
    KeyName: config.input.keyName
  };

  try {
    const instances = [];
    for (let idx = 0; idx < config.input.numberOfMachines; idx++) {
      const result = await ec2.runInstances(params).promise();
      const ec2InstanceId = result.Instances[0].InstanceId;
      instances.push(ec2InstanceId);
      core.info(`AWS EC2 instance ${ec2InstanceId} is started`);
    }
    return instances;
  } catch (error) {
    core.error('AWS EC2 instance starting error');
    throw error;
  }
}

async function terminateEc2Instances() {
  const ec2 = new AWS.EC2();

  const params = {
    InstanceIds: config.input.ec2InstancesIds,
  };
  core.info(`Terminating Ec2 instances ${config.input.ec2InstancesIds.join(" ")}`);
  try {
    await ec2.terminateInstances(params).promise();
    core.info(`AWS EC2 instances ${config.input.ec2InstancesIds.join(" ")} is terminated`);
    return;
  } catch (error) {
    core.error(`AWS EC2 instance ${config.input.ec2InstancesIds} termination error`);
    throw error;
  }
}

async function waitForInstancesRunning(ec2InstancesId) {
  const ec2 = new AWS.EC2();
  const errors = []

  for (const ec2InstanceId of ec2InstancesId) {
    const params = {
      InstanceIds: [ec2InstanceId],
    };

    try {
      await ec2.waitFor('instanceRunning', params).promise();
      core.info(`AWS EC2 instance ${ec2InstanceId} is up and running`);
      return;
    } catch (error) {
      core.error(`AWS EC2 instance ${ec2InstanceId} initialization error`);
      errors.push(error)
    }
  }
  if (errors.length > 0) {
    throw errors
  }
}

module.exports = {
  startEc2Instance,
  terminateEc2Instances,
  waitForInstancesRunning,
};
