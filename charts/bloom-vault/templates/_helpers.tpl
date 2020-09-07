{{/* vim: set filetype=mustache: */}}
{{/* Expand the name of the chart.  */}}
{{- define "bloom-vault.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* Create chart name and version as used by the chart label.  */}}
{{- define "bloom-vault.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "bloom-vault.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/* bloom-vault server */}}


{{/*
Define fully qualified server name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
*/}}
{{- define "bloom-vault.server.fullname" -}}
{{- printf "%s-%s" (include "bloom-vault.fullname" .) .Values.server.name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Common labels */}}
{{- define "bloom-vault.server.labels" -}}
helm.sh/chart: {{ include "bloom-vault.chart" . }}
{{ .Values.server.selectorLabels }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/* Selector labels */}}
{{- define "bloom-vault.server.selectorLabels" -}}
app.kubernetes.io/name: {{ include "bloom-vault.server.fullname" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/* Create the name of the service account to use */}}
{{- define "bloom-vault.server.serviceAccountName" -}}
{{- if .Values.server.serviceAccount.create }}
{{- default (include "bloom-vault.server.fullname" .) .Values.server.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.server.serviceAccount.name }}
{{- end }}
{{- end }}
