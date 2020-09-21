node {
  SSH_KEY = sh(returnStdout: true, script: 'cat /srv/jenkins/ssh_key')
  NPMRC = sh(returnStdout: true, script: 'cat /srv/jenkins/npmrc')
}

pipeline {
  environment {
    credentialsId = 'docker-hub-credentials'
  }

  agent any

  stages {
    stage('checkout') {
        steps {
          checkout scm
          script {
            env.GIT_BRANCH_NAME=sh(returnStdout: true, script: "git rev-parse --abbrev-ref HEAD").trim()
            env.GIT_REF=sh(returnStdout: true, script: "git rev-parse HEAD").trim()
          }
        }
    }
    stage('build') {
      steps {
        slackSend (
          message: "Jenkins PR build (${env.GIT_BRANCH_NAME}: ${env.GIT_REF}) - Building: ${env.BUILD_URL}display/redirect",
          color: "#6067f1"
        )
        script {
          docker.withRegistry('', credentialsId) {
            sh """
            docker build -f Dockerfile . --build-arg SSH_KEY="$SSH_KEY" --build-arg NPMRC='$NPMRC' -t hellobloom/bloom-vault:${env.GIT_REF}
            """
          }
        }
        slackSend (
          message: "Jenkins PR build (${env.GIT_BRANCH_NAME}: ${env.GIT_REF}) - Finished build",
          color: "#00e981"
        )
      }
    }
    stage('deps') {
      steps {
        slackSend (
          message: "Jenkins PR build (${env.GIT_BRANCH_NAME}: ${env.GIT_REF}) - Installing dependencies...",
          color: "#6067f1"
        )
        script {
          sh """
          npm ci
          """
        }
        slackSend (
          message: "Jenkins PR build (${env.GIT_BRANCH_NAME}: ${env.GIT_REF}) - Dependencies installed",
          color: "#00e981"
        )
      }
    }
    stage('ci'){
      parallel {
        stage('test'){
          steps {
            slackSend (
              message: "Jenkins PR build (${env.GIT_BRANCH_NAME}: ${env.GIT_REF}) - Tests...",
              color: "#6067f1"
            )
            script {
              sh """
              bin/test.sh
              """
            }
            slackSend (
              message: "Jenkins PR build (${env.GIT_BRANCH_NAME}: ${env.GIT_REF}) - Tests finished",
              color: "#00e981"
            )
          }
        }
        stage('prettier'){
          steps {
            slackSend (
              message: "Jenkins PR build (${env.GIT_BRANCH_NAME}: ${env.GIT_REF}) - Prettier...",
              color: "#6067f1"
            )
            echo 'Running prettier...'
            script {
              sh """
                bin/prettier.sh
              """
            }
            slackSend (
              message: "Jenkins PR build (${env.GIT_BRANCH_NAME}: ${env.GIT_REF}) - Prettier finished",
              color: "#00e981"
            )
          }
        }
        stage('tslint'){
          steps {
            slackSend (
              message: "Jenkins PR build (${env.GIT_BRANCH_NAME}: ${env.GIT_REF}) - Tslint...",
              color: "#6067f1"
            )
            script {
              sh """
                bin/tslint.sh
              """
            }
            slackSend (
              message: "Jenkins PR build (${env.GIT_BRANCH_NAME}: ${env.GIT_REF}) - Tslint finished",
              color: "00e981"
            )
          }
        }
      }
    }
    stage('publish') {
      steps {
        slackSend (
          message: "Jenkins PR build (${env.GIT_BRANCH_NAME}: ${env.GIT_REF}) - Publishing...",
          color: "#6067f1"
        )
        script {
          docker.withRegistry('', credentialsId) {
            sh """
            docker push hellobloom/bloom-vault:${env.GIT_REF}
            """
          }
        }
        slackSend (
          message: "Jenkins PR build (${env.GIT_BRANCH_NAME}: ${env.GIT_REF}) - Publish finished! ${env.BUILD_URL}display/redirect",
          color: "#ea8afb"
        )
      }
    }
  }

  post {
    unsuccessful {
      slackSend (
        message: "Jenkins PR build (${env.GIT_BRANCH_NAME}: ${env.GIT_REF}) - Unsuccessful ${env.BUILD_URL}display/redirect",
        color: "#c13801"
      )
    }
  }
}