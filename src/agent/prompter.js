import { readFileSync, mkdirSync, writeFileSync} from 'fs';
import { Examples } from '../utils/examples.js';
import { getCommandDocs, getCommandDocs2, commandExists } from './commands/index.js';
import { getSkillDocs } from './library/index.js';
import { stringifyTurns } from '../utils/text.js';
import { getCommand, containsCommand, executeCommand, truncCommandMessage } from './commands/index.js';

import { Gemini } from '../models/gemini.js';
import { GPT } from '../models/gpt.js';
import { Claude } from '../models/claude.js';
import { ReplicateAPI } from '../models/replicate.js';
import { Local } from '../models/local.js';
import { Novita } from '../models/novita.js';
import { GroqCloudAPI } from '../models/groq.js';
import { HuggingFace } from '../models/huggingface.js';
import { Qwen } from "../models/qwen.js";
import { Grok } from "../models/grok.js";
import settings from '../../settings.js';
import { REPL_MODE_STRICT } from 'repl';


export class Prompter {
    constructor(agent, pf) {
        this.agent = agent;
        this.profile = pf
        this.convo_examples = null;
        this.coding_examples = null;
        
        let name = this.profile.name;
        let chat = this.profile.model;
        this.cooldown = this.profile.cooldown ? this.profile.cooldown : 0;
        this.last_prompt_time = 0;

        // try to get "max_tokens" parameter, else null
        let max_tokens = null;
        if (this.profile.max_tokens)
            max_tokens = this.profile.max_tokens;
        if (typeof chat === 'string' || chat instanceof String) {
            chat = {model: chat};
            if (chat.model.includes('gemini'))
                chat.api = 'google';
            else if (chat.model.includes('gpt') || chat.model.includes('o1'))
                chat.api = 'openai';
            else if (chat.model.includes('claude'))
                chat.api = 'anthropic';
            else if (chat.model.includes('huggingface/'))
                chat.api = "huggingface";
            else if (chat.model.includes('meta/') || chat.model.includes('mistralai/') || chat.model.includes('replicate/'))
                chat.api = 'replicate';
            else if (chat.model.includes("groq/") || chat.model.includes("groqcloud/"))
                chat.api = 'groq';
            else if (chat.model.includes('novita/'))
                chat.api = 'novita';
            else if (chat.model.includes('qwen'))
                chat.api = 'qwen';
            else if (chat.model.includes('grok'))
                chat.api = 'xai';
            else
                chat.api = 'ollama';
        }

        console.log('Using chat settings:', chat);

        if (chat.api === 'google')
            this.chat_model = new Gemini(chat.model, chat.url);
        else if (chat.api === 'openai')
            this.chat_model = new GPT(chat.model, chat.url);
        else if (chat.api === 'anthropic')
            this.chat_model = new Claude(chat.model, chat.url);
        else if (chat.api === 'replicate')
            this.chat_model = new ReplicateAPI(chat.model, chat.url);
        else if (chat.api === 'ollama')
            this.chat_model = new Local(chat.model, chat.url);
        else if (chat.api === 'groq') {
            this.chat_model = new GroqCloudAPI(chat.model.replace('groq/', '').replace('groqcloud/', ''), chat.url, max_tokens ? max_tokens : 8192);
        }
        else if (chat.api === 'huggingface')
            this.chat_model = new HuggingFace(chat.model, chat.url);
        else if (chat.api === 'novita')
            this.chat_model = new Novita(chat.model.replace('novita/', ''), chat.url);
        else if (chat.api === 'qwen')
            this.chat_model = new Qwen(chat.model, chat.url);
        else if (chat.api === 'xai')
            this.chat_model = new Grok(chat.model, chat.url);
        else
            throw new Error('Unknown API:', api);

        let embedding = this.profile.embedding;
        if (embedding === undefined) {
            if (chat.api !== 'ollama')
                embedding = {api: chat.api};
            else
                embedding = {api: 'none'};
        }
        else if (typeof embedding === 'string' || embedding instanceof String)
            embedding = {api: embedding};

        console.log('Using embedding settings:', embedding);

        try {
            if (embedding.api === 'google')
                this.embedding_model = new Gemini(embedding.model, embedding.url);
            else if (embedding.api === 'openai')
                this.embedding_model = new GPT(embedding.model, embedding.url);
            else if (embedding.api === 'replicate')
                this.embedding_model = new ReplicateAPI(embedding.model, embedding.url);
            else if (embedding.api === 'ollama')
                this.embedding_model = new Local(embedding.model, embedding.url);
            else if (embedding.api === 'qwen')
                this.embedding_model = new Qwen(embedding.model, embedding.url);
            else {
                this.embedding_model = null;
                console.log('Unknown embedding: ', embedding ? embedding.api : '[NOT SPECIFIED]', '. Using word overlap.');
            }
        }
        catch (err) {
            console.log('Warning: Failed to initialize embedding model:', err.message);
            console.log('Continuing anyway, using word overlap instead.');
            this.embedding_model = null;
        }

        mkdirSync(`./bots/${name}`, { recursive: true });
        writeFileSync(`./bots/${name}/last_profile.json`, JSON.stringify(this.profile, null, 4), (err) => {
            if (err) {
                throw new Error('Failed to save profile:', err);
            }
            console.log("Copy profile saved.");
        });
    }

    getName() {
        return this.profile.name;
    }

    getInitModes() {
        return this.profile.modes;
    }

    async initExamples() {
        try {
            this.convo_examples = new Examples(this.embedding_model);
            this.coding_examples = new Examples(this.embedding_model);
            
            const [convoResult, codingResult] = await Promise.allSettled([
                this.convo_examples.load(this.profile.conversation_examples),
                this.coding_examples.load(this.profile.coding_examples)
            ]);

            // Handle potential failures
            if (convoResult.status === 'rejected') {
                console.error('Failed to load conversation examples:', convoResult.reason);
                throw convoResult.reason;
            }
            if (codingResult.status === 'rejected') {
                console.error('Failed to load coding examples:', codingResult.reason);
                throw codingResult.reason;
            }
        } catch (error) {
            console.error('Failed to initialize examples:', error);
            throw error;
        }
    }

    async replaceStrings(prompt, messages, examples=null, to_summarize=[], last_goals=null) {
        prompt = prompt.replaceAll('$NAME', this.agent.name);

        if (prompt.includes('$STATS')) {
            let stats = await getCommand('!stats').perform(this.agent);
            prompt = prompt.replaceAll('$STATS', stats);
        }
        if (prompt.includes('$INVENTORY')) {
            let inventory = await getCommand('!inventory').perform(this.agent);
            prompt = prompt.replaceAll('$INVENTORY', inventory);
        }
        if (prompt.includes('$COMMAND_DOCS'))
            prompt = prompt.replaceAll('$COMMAND_DOCS', getCommandDocs2());
        if (prompt.includes('$CODE_DOCS'))
            prompt = prompt.replaceAll('$CODE_DOCS', getSkillDocs());
        //if (prompt.includes('$EXAMPLES') && examples !== null)
        //    prompt = prompt.replaceAll('$EXAMPLES', await examples.createExampleMessage(messages));
        if (prompt.includes('$MEMORY'))
            prompt = prompt.replaceAll('$MEMORY', this.agent.history.memory);
        if (prompt.includes('$TO_SUMMARIZE'))
            prompt = prompt.replaceAll('$TO_SUMMARIZE', stringifyTurns(to_summarize));
        if (prompt.includes('$CONVO'))
            prompt = prompt.replaceAll('$CONVO', 'Recent conversation:\n' + stringifyTurns(messages));
        //if (prompt.includes('$SELF_PROMPT')) {
        //    let self_prompt = this.agent.self_prompter.on ? `YOUR CURRENT ASSIGNED GOAL: "${this.agent.self_prompter.prompt}"\n` : '';
        //    prompt = prompt.replaceAll('$SELF_PROMPT', self_prompt);
        //}
        if (prompt.includes('$LAST_GOALS')) {
            let goal_text = '';
            for (let goal in last_goals) {
                if (last_goals[goal])
                    goal_text += `You recently successfully completed the goal ${goal}.\n`
                else
                    goal_text += `You recently failed to complete the goal ${goal}.\n`
            }
            prompt = prompt.replaceAll('$LAST_GOALS', goal_text.trim());
        }
        if (prompt.includes('$BLUEPRINTS')) {
            if (this.agent.npc.constructions) {
                let blueprints = '';
                for (let blueprint in this.agent.npc.constructions) {
                    blueprints += blueprint + ', ';
                }
                prompt = prompt.replaceAll('$BLUEPRINTS', blueprints.slice(0, -2));
            }
        }

        // check if there are any remaining placeholders with syntax $<word>
        let remaining = prompt.match(/\$[A-Z_]+/g);
        if (remaining !== null) {
            console.warn('Unknown prompt placeholders:', remaining.join(', '));
        }
        return prompt;
    }

    async checkCooldown() {
        let elapsed = Date.now() - this.last_prompt_time;
        if (elapsed < this.cooldown && this.cooldown > 0) {
            await new Promise(r => setTimeout(r, this.cooldown - elapsed));
        }
        this.last_prompt_time = Date.now();
    }

    async promptConvo(messages) {
        await this.checkCooldown();
        let prompt = this.profile.conversing;
        prompt = await this.replaceStrings(prompt, messages, this.convo_examples);
        return await this.chat_model.sendRequest(messages, prompt);
    }

    async promptCoding(messages) {
        await this.checkCooldown();
        let prompt = this.profile.coding;
        prompt = await this.replaceStrings(prompt, messages, this.coding_examples);
        return await this.chat_model.sendRequest(messages, prompt);
    }

    async promptMemSaving(to_summarize) {
        await this.checkCooldown();
        let prompt = this.profile.saving_memory;
        prompt = await this.replaceStrings(prompt, null, null, to_summarize);
        return await this.chat_model.sendRequest([], prompt);
    }

    async promptGoalSetting(messages, last_goals) {
        let system_message = this.profile.goal_setting;
        system_message = await this.replaceStrings(system_message, messages);

        let user_message = 'Use the below info to determine what goal to target next, be sure to take into account your current situation and set a goal of a small scale\n\n';
        user_message += '$LAST_GOALS\n\n$STATS\n\n$INVENTORY\n\n$CONVO'
        user_message = await this.replaceStrings(user_message, messages, null, null, last_goals);
        let user_messages = [{role: 'user', content: user_message}];

        let res = await this.chat_model.sendRequest([], system_message);

        let goal = null;
        try {
            let data = res.split('```')[1].replace('json', '').trim();
            goal = JSON.parse(data);
        } catch (err) {
            console.log('Failed to parse goal:', res, err);
        }
        if (!goal || !goal.name || !goal.quantity || isNaN(parseInt(goal.quantity))) {
            console.log('Failed to set goal:', res);
            return null;
        }
        goal.quantity = parseInt(goal.quantity);
        return goal;
    }

    
    async promptGoalScore(goal_prompt, goals) {
        console.log("prompting for goal score");

        let prompt = `You are playing minecraft, score the importance and feasibility of each goal below by considering your current status and surroundings.
       
        IMPORTANT: You must attribute a score to each goal with a number between 0 and 100, where:
        - 0 means completely impossible or irrelevant
        - 50 means moderately important and feasible
        - 100 means urgent and extremely important
       
        Rules for scoring:
        1. Consider both importance AND feasibility
        2. Higher scores for goals that:
           - Match the bot's current needs
           - Are achievable with more attainable ressources: give priority to goals that are achievable with items in your inventory, then with the surrounding blocks, then close saved locations, then biome, then other saved locations.
           - Are prerequisites for other goals
           - Have an approaching deadline
        3. Lower scores for goals that:
           - Require unavailable resources, or ressources that are stored further away than for other goals
           - Are too complex for the current situation
           - Are less urgent
       
        FORMAT: For each goal STRICTLY respond with EXACTLY this format:
        
        goal description: score

        DO NOT use any symbols, numbers, or bullet points like:
        - goal description: score
        1. goal description: score
        * goal description: score
        

        __CONTEXT AND GOALS__\n\n${goal_prompt}`;
       
        const MAX_RETRIES = 10000;
        let retryCount = 0;
       
        while (retryCount < MAX_RETRIES) {
            let res = await this.chat_model.sendRequest([], prompt);
            console.log("Raw response:", res);
            const lines = res.split('\n');
            const new_agenda = [];
            
            for (const line of lines) {
                // Modified regex to handle optional "GOAL:" prefix
                const scoreMatch = line.match(/^(?:GOAL:\s*)?(.+):\s*(\d+)\s*$/);
                if (scoreMatch) {
                    const goal = scoreMatch[1].trim();
                    const score = parseInt(scoreMatch[2]);
                    // Case-insensitive check against goals array
                    const matchingGoal = goals.find(g => {
                        // Remove "GOAL:" prefix if present for comparison
                        const normalizedGoal = g.replace(/^GOAL:\s*/i, '');
                        const normalizedInput = goal.replace(/^GOAL:\s*/i, '');
                        return normalizedGoal.toLowerCase() === normalizedInput.toLowerCase();
                    });
                    
                    if (score >= 0 && score <= 100 && matchingGoal) {
                        new_agenda.push({ goal: matchingGoal, score: score });
                    }
                }
            }
        
            const missingGoals = goals.filter(prevGoal => 
                !new_agenda.some(item => item.goal === prevGoal)
            );
            
            if (missingGoals.length > 0) {
                console.log("Missing scores for goals:", missingGoals);
                retryCount++;
                prompt += `\n\nPlease provide scores for ALL goals. Missing scores for:\n${missingGoals.join('\n')}`;
                continue;
            }
            return new_agenda;
        }
    
        // If we've exhausted retries, return a default score
        console.log("Failed to get valid score after", MAX_RETRIES, "attempts");
    }
    //could add a way of thinking to make sure requirements for each step are met
    //"Think about the final state of achieving the goal and work backward to your current situation to determine the necessary steps."
    async promptActionList(context) {
        let command_docs = getCommandDocs2();
         console.log("prompting for action list");

        let prompt = `You are playing minecraft and need to break down a given goal into simple steps to execute one after another in minecraft to achieve the goal. 
        Each step should be written in natural language but achievable using only one of the given commands, do not combine them or create new ones.
        You have no limit of steps, but a limit of 2000 tokens for your output.
        If you require a step for analyzing your current situation, such as the progress of a certain part of the goal,  Start the line with "Logic: " 
        Be as detailed as possible for each step and be sure to analyse the given context when thinking about how to achieve the goal and the conditions for each step you are coming up with.

        GOAL TO ACHIEVE:
        ${context}

        FORMAT YOUR RESPONSE AS:
        1. Clear action in natural language
        2. Next clear action in natural language
        3. Following clear action in natural language

        EXAMPLE: 
        GOAL : Eat food to heal and fill hunger bar

        important context you have selected from all the context given the goal :
        - 10/20 Health
        - 13/20 Hunger
        - No food in inventory
        - Cows nearby
        - No nearby oven
        - No beef in inventory
        - No oak logs in inventory but block available nearby
        - No coal in inventory
        - 21 blocks of cobble stone in inventory

        Expected answer : 
        1. Search for a cow
        2. Move near cow
        3. Kill cow
        4. Pick up dropped items
        5. Logic: Verify if enough raw beef has been collected to fill health and hunger bars or if hunger is too low to sprint, else repeat actions
        6. Collect oak logs for crafting table and burning fuel
        7. Craft crafting table
        8. Place crafting table
        9. Craft oven
        10. Place oven
        11. Place uncooked beef and planks in oven
        12. Wait for beef to cook and collect cooked beef
        13. Eat beef
        14. Logic: Verify if bars are filled up, else repeat actions 

        Bad answer :
        1. Search for a cow
        2. Kill cow
        3. Cook meat
        4. If there are no cows nearby, search for a pig
        5. Kill pig
        6. Cook meat
        7. Eat cooked meat

        The bad answer has the following problems:
        - The steps are not clear enough to be executed and need to be broken down into simpler steps
        - The steps are not in chronological order, the verification of nearby cows should be done before killing them
        - You could verify if you have enough food at the end

        WHEN TO USE "Logic :"
        - Use "Logic:" when you want to verify if your previous actions were enough or need to be repeated but only in this format
        - Use "Logic:" when you want to analyse if the following actions are necessary
        - Use "Logic:" when you want to analyse if the condiutions for the following actions are met

        WRITING RULES
        - Write each step in natural language that maps to ONE available command
        - Do NOT write the commands, your goal is to explain the action in natural language 
        - Start each line with a number and period
        - Be specific about blocks, items, and locations
        - Keep steps in chronological order
        - Write complete, clear actions
        - Do not add Action: for regular actions
        - Avoid repeating the same action multiple times in a row. You can use Logic: to verify if a repeat of the previous actions are still needed
        - NO additional text or explanations

        Available commands for reference:
        ${command_docs}

        Now list ONLY the numbered steps needed to achieve the goal above. NO other text.`;
        while(true) {
            let res = await this.chat_model.sendRequest([], prompt);
            let actions = await this.parseActionList(res);
            
            if (actions.length > 0) {
                console.log("ORIGINAL TEXT:\n"+res)
                console.log("ACTION LIST:\n"+ actions + "\nend of list");
                return actions;
            }
        }
    }

    async parseActionList(res) {
        if (!res || typeof res !== 'string') {
         return [];
        }
      
        const regex = /\d+[\.\)]\s*([^\n]*?)(?=(?:\n\s*\d+[\.\)]|$))/g;
        let matches = [...res.matchAll(regex)]
         .map(match => {
          let action = match[1]
           .split(/\s*[-–]\s*/)[0]
           .replace(/^(?:first|then|next|finally|lastly|afterwards),?\s*/i, '')
           .replace(/\.$/, '')
           .trim();
          return action;
         })
         .filter(action => action && action.length > 0 && action.length < 200);
      
        return matches.map(action => {
         if (action.startsWith('Logic:')) {
          return ['logic', action.substring('Logic:'.length).trim()];
         } else {
          return ['action', action];
         }
        });
    }
    
    
    async promptActionLogic(type, action, action_log, action_list) { //add logic analysis part of code later
        
        let command_docs = getCommandDocs2();

        console.log("prompting for action logic");

        if (type == 'action') 
        {
            let prompt = `You are charged with evaluating if the current action can be executed using the available commands so that a minecraft bot can perform said action.
            You are given a list of commands that the bot can use to perform actions.
            You need to determine if the action can be performed using any of the commands given.
            You are given the actions that have already been performed  under PREVIOUS ACTIONS and the actions that are still to be performed under FOLLOWING ACTIONS.

            Say 'yes' if:
            - The prompt could be executed using a command from the list
            - The intent is clear enough to map to a command
            
            Say 'no' if:
            - The prompt doesn't have any available command that seems to be able to execute it

            CURRENT ACTION AND CONTEXT: 
            ${action}

            PREVIOUS ACTIONS:
            ${action_log}

            FOLLOWING ACTIONS:
            ${action_list}


            EXAMPLE: 
            GOAL : Eat food to heal and fill hunger bar
            
            CURRENT ACTION AND CONTEXT:
            craft oven and cook beef

            PREVIOUS ACTIONS:
            Search for a cow
            Move near cow
            Kill cow
            Pick up dropped items
            Logic: Verify if enough raw beef has been collected to fill health and hunger bars or if hunger is too low to sprint, else repeat actions
            Collect oak logs for crafting table and burning fuel
            Craft crafting table
            Place crafting table

            FOLLOWING ACTIONS:
            Eat beef
            Logic: Verify if bars are filled up, else repeat actions 

            Expected answer : 
            no

            Bad answer :
            yes

            AVAILABLE COMMANDS:
            ${command_docs}

            Answer with ONLY 'yes' or 'no'.`;
        
            while(true) {
                let res = await this.chat_model.sendRequest([], prompt);
                console.log("RESPONSE: "+res)
                // Clean up the response
                res = res.trim()                    // Remove whitespace
                    .toLowerCase()                   // Convert to lowercase
                    .replace(/[.,!?:;\n\r]+/g, '')  // Remove punctuation and line breaks
                    .replace(/^(let me|i think|based on|after|given|analysis:|answer:)/i, '') // Remove common LLM prefixes
                    .trim();                        // Trim again after cleanup
                
                // Extract just the yes/no if it's embedded in text
                if (res.includes('yes')) {
                    res = 'yes';
                } else if (res.includes('no')) {
                    res = 'no';
                }
                
                if (res === "yes") {
                    return [true, null];
                } else if (res === "no") {
                    let new_actions = await this.promptActionBreakdown(action, action_log, action_list);
                    return [false, new_actions];
                }
            
                
                // If we get here, the response was invalid
                prompt = `${prompt}
        
                Your last answer was invalid. You MUST respond with ONLY the single word 'yes' or 'no'.
                Do not add any explanation, punctuation, or additional text.
                Response must be exactly 'yes' or 'no'.`;
            }
        } else if (type == 'logic') {
          	
        }
    }

    async promptActionBreakdown(action, action_list, action_log) {
      let command_docs = getCommandDocs2();

      console.log("prompting for action breakdown");
      console.log("ACTION: "+action)
      let prompt = `You are tasked with breaking down the following action further down into simpler actions so that it can be realised with the available commands.
      You are given a list of commands that will be needed to perform actions.

      Each step should be written in natural language but achievable using only the given commands, do not create new ones.
      Limit your response to 2-5 new steps, but if you need more you have a maximum of 10.
      
      IMPORTANT: Respond ONLY with a numbered list of prompts to break down the action into simpler actions. 
      Base yourself on the commands given and the rest of the action list that the bot has to perform to achieve his goal.
      Each action should be achievable with a single command.
      Use the minimum possible of command. Keep the steps simple and direct, give the command and a short description of the action to be taken.

      ACTION TO BREAK DOWN AND CONTEXT: 
      ${action}

      PREVIOUS ACTIONS:
      ${action_log}

      FOLLOWING ACTIONS:
      ${action_list}

      EXAMPLE: 
      GOAL : Eat food to heal and fill hunger bar
      
      CURRENT ACTION AND CONTEXT:
      craft oven and cook beef

      PREVIOUS ACTIONS:
      Search for a cow
      Move near cow
      Kill cow
      Pick up dropped items
      Logic: Verify if enough raw beef has been collected to fill health and hunger bars or if hunger is too low to sprint, else repeat actions
      Collect oak logs for crafting table and burning fuel
      Craft crafting table
      Place crafting table

      FOLLOWING ACTIONS:
      Eat beef
      Logic: Verify if bars are filled up, else repeat actions 

      Expected answer : 
      Craft oven
      Place oven
      Place uncooked beef and planks in oven
      Wait for beef to cook and collect cooked bee

      Bad answer :
      Craft oven
      Cook meat in oven
      Collect cooked meat

      WRITING RULES:
      - Write each step in natural language that maps to ONE available command
      - Start each line with a number and period
      - Be specific about blocks, items, and locations
      - Keep steps in chronological order
      - Write complete, clear actions
      - NO additional text or explanations
      - Quantify the number of items you estimate would be needed for steps that could be done with multiple items

      Available commands for reference:
      ${command_docs}`;
      
          while(true) {
              let res = await this.chat_model.sendRequest([], prompt);
              let simpleActions = await this.parseActionList(res);
              
              // We want 2-3 steps, no more no less
              if (simpleActions.length >= 1 && simpleActions.length <= 10) {
                  console.log("Breaking down action");
                  console.log("Into steps:", simpleActions);
                  return simpleActions;
              }
      
              // If we get here, the response wasn't in the right format
              prompt += "\n\nYour last answer wasn't in the correct format. Please provide exactly 2-3 simple steps.";
          }
    }

    async promptAction(action_context) {
      let command_docs = getCommandDocs2();
      console.log("prompting for action");
      let failsafe = 0;
      let res = '';
      let command_name = '';
      while (true) {

        let prompt = `You are playing minecraft through the use of commands and are tasked with returning the command that should be executed to perform the given action below.
        You are given a list of commands that the bot can use to perform actions.
        Given the context of the action, you need to determine which command should be executed to perform the action and what parameters to input into it
        This is the action you need to perform: \n${action_context}
        
        Available commands:
        ${command_docs}`;

        res = await this.chat_model.sendRequest([], prompt);
        
        console.log("Raw response:", res);
        command_name = containsCommand(res);
        res = truncCommandMessage(res);

        console.log("Command name:", command_name);
        console.log("Command message:", res);

        if (!commandExists(command_name)) {
          prompt+=`\n\nWARNING\nYou have hallucinated the following command: ${command_name}`
          console.log(`Agent has hallucinated the following command: ${command_name}`);
        } else {break}
        failsafe++;
        if (failsafe > 10) {
          command_name = await this.agent.handleMessage("system", prompt, 5);
          return command_name;
        }
      }
        
        if (settings.verbose_commands) {
                this.agent.cleanChat(res, res.indexOf(command_name));
        } else { // only output command name
            let pre_message = res.substring(0, res.indexOf(command_name)).trim();
            let chat_message = `*used ${command_name.substring(1)}*`;
            if (pre_message.length > 0)
                chat_message = `${pre_message}  ${chat_message}`;
            this.agent.cleanChat(res);
        }

        let execute_res = await executeCommand(this, res);

        console.log('Agent executed:', command_name, 'and got:', execute_res);
        return res;
    }

    async promptActionResult (prompt, action, action_context, command) {

    }

    async promptGoalResult (goal, final_context, action_log) {
    
    }
}