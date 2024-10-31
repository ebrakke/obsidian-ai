import { requestUrl, RequestUrlParam } from "obsidian";

export interface ModelObject {
  id: string;
  created: number;
  owned_by: string;
}

interface CompletionRequest {
  model: string;
  messages: Array<{
    role: string;
    content: string;
  }>;
  temperature?: number;
  max_tokens?: number;
}

interface CompletionResponse {
  id: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface AIClient {
  listModels(): Promise<ModelObject[]>;
  createCompletion(request: CompletionRequest): Promise<CompletionResponse>;
  createChatCompletion(messages: string, model: string, systemPrompt?: string, temperature?: number, maxTokens?: number): Promise<string>;
}

export class OpenAIClient implements AIClient {
    private apiKey: string;
    private baseURL: string;

    constructor(apiKey: string, baseURL: string) {
        this.apiKey = apiKey;
        this.baseURL = baseURL.endsWith('/') ? baseURL : baseURL + '/';
    }

    private async makeRequest<T>(endpoint: string, method: string, body?: any): Promise<T> {
        const requestPayload: RequestUrlParam = {
            url: this.baseURL + endpoint, 
            method,
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
            },
        }
        if (body) {
            requestPayload.body = JSON.stringify(body);
        }
        console.log('requestPayload', requestPayload);
        const response = await requestUrl(requestPayload);
        return response.json as T;
    }

  async listModels(): Promise<ModelObject[]> {
    const response = await this.makeRequest<{ data: ModelObject[] }>('models', 'GET');
    return response.data;
  }

  async createCompletion(request: CompletionRequest): Promise<CompletionResponse> {
    return this.makeRequest<CompletionResponse>('chat/completions', 'POST', request);
  }

  async createChatCompletion(
    message: string,
    model: string = 'default',
    systemPrompt?: string,
    temperature: number = 0.7,
    maxTokens?: number
  ): Promise<string> {
    const messages = [{
      role: 'user',
      content: message
    }];
    if (systemPrompt) {
      messages.unshift({
        role: 'system',
        content: systemPrompt
      });
    }
    const response = await this.createCompletion({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    });

    return response.choices[0].message.content;
  }
}

export class AnthropicClient implements AIClient {
    private apiKey: string;
    private baseURL: string; 

    constructor(apiKey: string, baseURL: string) {
        this.apiKey = apiKey;
        this.baseURL = baseURL.endsWith('/') ? baseURL : baseURL + '/';
    }

    private async makeRequest<T>(endpoint: string, method: string, body?: any): Promise<T> {
        console.log('body', body);
        try {
            const requestPayload: RequestUrlParam = {
                url: this.baseURL + endpoint,
                method,
                headers: {
                    'x-api-key': this.apiKey,
                    'anthropic-version': '2023-06-01',
                    'Content-Type': 'application/json',
                },
            }
            if (body) {
                requestPayload.body = JSON.stringify(body);   
            }
            console.log('requestPayload', {...requestPayload, body});
            const response = await requestUrl(requestPayload);
            return response.json as T;
        } catch (error) {
            console.log(error);
            throw error;
        }
    }

    async listModels(): Promise<ModelObject[]> {
        return [{
            id: 'claude-3-haiku-20240307',
            created: 0,
            owned_by: 'anthropic'
        }, {
            id: 'claude-3-5-sonnet-latest',
            created: 0,
            owned_by: 'anthropic'
        }];
    }

    async createCompletion(request: CompletionRequest & { system?: string }): Promise<CompletionResponse> {
        const response = await this.makeRequest<{content: {text: string}[]}>('messages', 'POST', request);
        console.log('response', response);
        return {
            id: '',
            choices: [{
                message: {
                    role: 'assistant',
                    content: response.content[0].text
                },
                finish_reason: 'stop'
            }],
            usage: {
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0
            }
        }
    } 

    async createChatCompletion(
        message: string,
        model: string = 'default',
        systemPrompt?: string,
        temperature: number = 0.7,
        maxTokens: number = 4096
    ): Promise<string> {
        const response = await this.createCompletion({
            model,
            messages: [{
                role: 'user',
                content: message
            }],
            system: systemPrompt,
            temperature,
            max_tokens: maxTokens,
        });
        return response.choices[0].message.content;
    }
}