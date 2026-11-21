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
  {{- if eq .Values.podry.workloadKind "Job" }}
  restartPolicy: Never
  {{- end }}
  containers:
    - name: app
      image: {{ .Values.podry.imageRef | quote }}
      imagePullPolicy: IfNotPresent
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
{{- end -}}
