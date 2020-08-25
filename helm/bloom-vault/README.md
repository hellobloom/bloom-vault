# Kubernetes Helm Chart for Bloom Vault 

Kubernetes deployment for Bloom Vault service (bloom-vault). The deployments, services, ingresses and other resources are installed with Helm charts. Helm allows to install, uninstall, upgrades and rollbacks.

### Requirements

The following are required for this procedure.

#### Environment:

- Kubernetes cluster v1.16 or later
- Kubernetes config authentication file
- Helm client installed

  ```
  brew update
  brew install helm
  ```

#### Secrets

- bloom-vault-env-secret:  
  env
- bloom-vault-postgres-secret:
  postgres certificate
- myregistrykey:  
  docker registry login

### Configuration

The application deployment is specified as variables and templates.

Create a new branch for each deployment. Edit the config files for the intended purpose (i.e. dev, stage, prod). For example, the image tag should be specified in the values.yaml.

- Chart.yaml:  
  Info about chart including chart name, app version and chart version.
- values.yaml:  
  The default configuration values for this chart.

### Deploy

To deploy the application. The command must be run from the helm chart top-level directory. i.e. where the Chart.yaml and values.yaml reside.

Example: Deploy service with latest image in the bloom-vault namespace.

```
helm install bloom-vault . -n bloom-vault
```

Example: Deploy service in the bloom-vault namespace and specify image tag.

```
helm install bloom-vault . -n bloom-vault --set image.tag=9f94eb18a9b1003cc7a7b7a7c296baa100814b44
```

### Verify

To verify the helm deployment, list all Helm deployments in the namespace bloom-vault.

```
helm -n bloom-vault ls
```

### Upgrade

Upgrade service in the bloom-vault namespace after updating values.yaml or helm templates.

```
helm -n bloom-vault upgrade bloom-vault .
```

### Uninstall

Uninstall service in the bloom-vault namespace.

```
helm -n bloom-vault uninstall bloom-vault
```
