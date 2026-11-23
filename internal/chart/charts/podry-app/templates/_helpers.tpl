{{- define "podry.labels" -}}
app.kubernetes.io/managed-by: Helm
app.kubernetes.io/instance: {{ .Release.Name | quote }}
podry.io/app-id: {{ .Values.podry.appId | quote }}
podry.io/binding-id: {{ .Values.podry.bindingId | quote }}
podry.io/deployment-id: {{ .Values.podry.deploymentId | quote }}
{{- end -}}
{{- define "podry.pod" -}}
metadata:
  labels:
    {{- include "podry.labels" . | nindent 4 }}
spec:
  automountServiceAccountToken: false
  {{- if .Values.podry.pullRegistry }}
  imagePullSecrets:
    - name: {{ .Values.podry.pullSecretName | quote }}
  {{- end }}
  {{- if eq .Values.podry.workloadKind "Job" }}
  restartPolicy: Never
  {{- end }}
  containers:
    - name: app
      image: {{ .Values.podry.imageRef | quote }}
      imagePullPolicy: IfNotPresent
      {{- if .Values.command }}
      command: {{ .Values.command | toJson }}
      {{- end }}
      {{- if .Values.args }}
      args: {{ .Values.args | toJson }}
      {{- end }}
      {{- range $key := list "readinessProbe" "livenessProbe" "startupProbe" }}
      {{- with index $.Values $key }}
      {{ $key }}: {{ . | toJson }}
      {{- end }}
      {{- end }}
      {{- if eq .Values.podry.workloadKind "Deployment" }}
      ports:
        - name: http
          containerPort: {{ .Values.containerPort }}
      {{- end }}
      resources: {{ .Values.resources | toJson }}
      env:
        {{- range $key, $value := .Values.env }}
        - name: {{ $key | quote }}
          value: {{ $value | quote }}
        {{- end }}
        {{- range .Values.podry.secretKeys }}
        - name: {{ . | quote }}
          valueFrom:
            secretKeyRef:
              name: {{ $.Values.podry.secretName | quote }}
              key: {{ . | quote }}
        {{- end }}
      {{- if or .Values.configFiles .Values.volumes }}
      volumeMounts:
        {{- if .Values.configFiles }}
        - name: podry-config
          mountPath: {{ .Values.configMountPath | quote }}
          readOnly: true
        {{- end }}
        {{- range .Values.volumes }}
        - name: {{ .name | quote }}
          mountPath: {{ .mountPath | quote }}
          readOnly: {{ .readOnly }}
        {{- end }}
      {{- end }}
  {{- if or .Values.configFiles .Values.volumes }}
  volumes:
    {{- if .Values.configFiles }}
    - name: podry-config
      configMap:
        name: {{ .Values.podry.configName | quote }}
    {{- end }}
    {{- range .Values.volumes }}
    - name: {{ .name | quote }}
      {{- if hasKey . "configMap" }}
      configMap: {{ .configMap | toJson }}
      {{- else if hasKey . "secret" }}
      secret: {{ .secret | toJson }}
      {{- else }}
      persistentVolumeClaim: {{ .persistentVolumeClaim | toJson }}
      {{- end }}
    {{- end }}
  {{- end }}
{{- end -}}
