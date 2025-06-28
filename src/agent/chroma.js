import { ChromaClient } from 'chromadb';

class MemoryManager {
    constructor(agent) {
        this.client = new ChromaClient();
        this.collections = {};
        this.memoryTypes = [
            'successful goals',
            'failed goals',
            'successful actions',
            'failed actions',
            'relationships'
        ];
        this.name = agent.name;
    }

    async initialize() {
        try {
            // Initialize collections for each memory type
            for (const memoryType of this.memoryTypes) {
                this.collections[memoryType] = await this.client.getOrCreateCollection({
                    name: `bot_${this.name}_${memoryType}_memory`,
                    metadata: {
                        description: `Storage for ${memoryType} memories`,
                    }
                });
                console.log(`initialised ${memoryType} successfully`)
            }
            console.log('Memory collections initialized successfully');
        } catch (error) {
            console.error('Error initializing memory collections:', error);
            throw error; // Rethrow or handle as appropriate
        }
    }

    async storeMemory(type, content, metadata = {}) {
        if (!this.memoryTypes.includes(type)) {
            throw new Error(`Invalid memory type: ${type}`);
        }

        try {
            const collection = this.collections[type];
            const id = `memory_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            await collection.add({
                ids: [id],
                documents: [content],
                metadatas: [{
                    ...metadata,
                    timestamp: new Date().toISOString(),
                    type: type
                }]
            });

            return id;
        } catch (error) {
            console.error(`Error storing ${type} memory:`, error);
            throw error;
        }
    }

    async queryMemory(type, query, limit = 5) {
        if (!this.memoryTypes.includes(type)) {
            throw new Error(`Invalid memory type: ${type}`);
        }

        try {
            const collection = this.collections[type];
            const results = await collection.query({
                queryTexts: [query],
                nResults: limit
            });

            return results;
        } catch (error) {
            console.error(`Error querying ${type} memory:`, error);
            throw error;
        }
    }

    async deleteMemory(type, id) {
        if (!this.memoryTypes.includes(type)) {
            throw new Error(`Invalid memory type: ${type}`);
        }

        try {
            const collection = this.collections[type];
            await collection.delete({
                ids: [id]
            });
        } catch (error) {
            console.error(`Error deleting memory ${id} from ${type}:`, error);
            throw error;
        }
    }

    async getAllMemories(type) {
        if (!this.memoryTypes.includes(type)) {
            throw new Error(`Invalid memory type: ${type}`);
        }

        try {
            const collection = this.collections[type];
            return await collection.get();
        } catch (error) {
            console.error(`Error retrieving all ${type} memories:`, error);
            throw error;
        }
    }
}


export default MemoryManager;