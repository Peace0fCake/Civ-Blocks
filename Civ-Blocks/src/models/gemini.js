import { GoogleGenerativeAI } from '@google/generative-ai';
import { toSinglePrompt } from '../utils/text.js';
import { getKey } from '../utils/keys.js';

export class Gemini {
    constructor(model_name, url) {
        this.model_name = 'gemini-2.0-flash';
        this.url = url;
        this.safetySettings = [
            {
                "category": "HARM_CATEGORY_DANGEROUS",
                "threshold": "BLOCK_NONE",
            },
            {
                "category": "HARM_CATEGORY_HARASSMENT",
                "threshold": "BLOCK_NONE",
            },
            {
                "category": "HARM_CATEGORY_HATE_SPEECH",
                "threshold": "BLOCK_NONE",
            },
            {
                "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                "threshold": "BLOCK_NONE",
            },
            {
                "category": "HARM_CATEGORY_DANGEROUS_CONTENT",
                "threshold": "BLOCK_NONE",
            },
        ];

        this.genAI = new GoogleGenerativeAI(getKey('GEMINI_API_KEY'));
    }

    async sendRequest(turns, systemMessage) {

    await new Promise(resolve => setTimeout(resolve, 4000));
    let model;
    if (this.url) {
        model = this.genAI.getGenerativeModel(
            { model: this.model_name || "gemini-1.5-flash" },
            { baseUrl: this.url },
            // Consider SDK docs for safetySettings placement, might be in 2nd arg
            { safetySettings: this.safetySettings }
        );
    } else {
        model = this.genAI.getGenerativeModel(
            { model: this.model_name || "gemini-1.5-flash" },
            { safetySettings: this.safetySettings }
        );
    }

    const stop_seq = '***';
    const prompt = toSinglePrompt(turns, systemMessage, stop_seq, 'model');
    console.log('Awaiting Google API response...');

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = await response.text();
        console.log('Received.');

        if (!text.includes(stop_seq)) {
            return text;
        }
        const idx = text.indexOf(stop_seq);
        return text.slice(0, idx);
    } catch (error) {
        console.error("Error during API call in sendRequest:", error);
        throw error;
    }
}

    async embed(text) {
        let model;
        if (this.url) {
            model = this.genAI.getGenerativeModel(
                { model: "text-embedding-004" },
                { baseUrl: this.url }
            );
        } else {
            model = this.genAI.getGenerativeModel(
                { model: "text-embedding-004" }
            );
        }

        const result = await model.embedContent(text);
        return result.embedding.values;
    }
}