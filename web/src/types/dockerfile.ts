export interface DockerfileTemplate {
  id: string
  language: string
  framework: string
}

export interface DockerfileTemplateContent extends DockerfileTemplate {
  content: string
}

export function dockerfileTemplateKey(language: string, framework: string): string {
  return JSON.stringify([language, framework])
}
