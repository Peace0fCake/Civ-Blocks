
import { queryList } from "./commands/queries.js";

export function startupLogic (agent) {
  //later on check if agent has a saved state and load it
  const agenda = [
    {goal: "build a house to be protected at night", score: 0}, 
    {goal: "get some wooden tools to collect resources", score: 0},
    {goal: "get some food to not die of hunger", score: 0},
    {goal: "explore to find a village", score:0}
  ]
  console.log(agenda)
  logicLoop(agent, [], agenda);
}

async function logicLoop(agent, last_goals, agenda) {
    while (true) {

        let context = await contextQuery(agent);
        // select goal
        const {goal, new_agenda} = await setGoal(agent, last_goals, agenda, context);
        agenda = new_agenda
        console.log("GOAL: "+goal);
        //create initial action list
        let action_list = await createActionList(agent, goal, context);

        //keep log of actions and commands used for each
        let action_log = [];

        //execute actions
        while (action_list.length > 0) {
            console.log("current action: "+action_list[0])
            let action = action_list[0];
            let prompt = '';
            
            prompt = `ACTION: ${action[1]}`;
            prompt += await contextQuery(agent);
            prompt += `\n\nSIMILAR MEMORIES: \n${await memQuery(prompt)}`;
            prompt += `MEMORY STREAM: \n${action_log}`

            //prompt on action logic (feasibility and if action is necessary or Interpret logic action)
            let [execute, new_actions] = await agent.prompter.promptActionLogic(action[0], prompt, action_log, action_list);
            //if action is not feasible, add new actions to the list and continue
            if (!execute) {
                action_list = [...new_actions, ...action_list];
                continue;
            }
            //prompt and execute command
            let command = await agent.prompter.promptAction(prompt);
            console.log("executing command: "+command)
            //use mindcraft action function to execute action
            action_log = [...action_log, ...[action, command]];
            let action_context = '';
            let result = await agent.prompter.promptActionResult(prompt, action, action_context, command);

            memStore(agent, 'action', action, result); //action context might need to be added for this function
        }

        let final_context = await contextQuery(agent);
        let goal_mem = await agent.prompter.promptGoalResult(goal, final_context, action_log);
        memStore(agent, 'goal', goal, goal_mem, context); //goal context might need to be added for this function
    }
}

export async function setGoal(agent, last_goals, agenda, context) {
    try {
        let prompt_context = '';
        // Set up base prompt
        prompt_context = `__GOALS OF LAST CYCLES__\n ${last_goals}`;
        prompt_context += context;

        let goal_prompt = '__AGENDA__\n\n';

        // Process each goal in agenda into the prompt
        let new_agenda = [];
        let goals = [];
        for (const item of agenda) {
            goals.push(item.goal);
            //Add information of stored goal in prompt
            goal_prompt += `GOAL:${item.goal}: ${item.score}`;
            //add memories to prompt
            goal_prompt += `\nGOAL SIMILAR MEMORIES: \n${await memQuery(item.goal + prompt_context)}\n`    
        }

        goal_prompt += prompt_context

        console.log(goal_prompt);

        new_agenda = await agent.prompter.promptGoalScore(goal_prompt, goals);

        // Sort goals by score (highest first)
        new_agenda.sort((a, b) => b.score - a.score);
        const new_goal = new_agenda[0].goal;

        console.log("NEW AGENDA:");
        console.log(new_agenda);

        // Return as object to handle multiple values
        return {
            goal: new_goal,
            goal_context: prompt_context,
            agenda: new_agenda
        };
    } catch(error) {
        console.log(error);
        throw error; // Re-throw to handle it at a higher level if needed
    }
}

async function createActionList(agent, goal, context) {
    let action_list = [];
    let prompt = '';

    prompt = `GOAL: ${goal}`;
    prompt += context;
    prompt += `\n\nSIMILAR MEMORIES: \n${await memQuery(prompt)}`;
    action_list = await agent.prompter.promptActionList(prompt);

    return action_list;
} 

async function contextQuery(agent) {
    let context =  '\n\n__CONTEXT__';

    context += `\n\nSTATUS: \n${await statusQuery(agent)}`;
    context += `\nVISION: \n${await visionQuery(agent)}`;
    return context;
}

export async function statusQuery(agent) { //returns environment data for prompting
    
    try {
        let curr_context = '';
        const allowedCommands = ["!stats", "!inventory", "!craftable", "!entities","!nearbyBlocks", "!savedPlaces"];

        for (let command of queryList) {
            if (allowedCommands.includes(command.name)) {  
                curr_context += await command.perform(agent);
            }
        }
        return curr_context;

    } catch(error) {
        console.log(error)
    }
}

async function visionQuery(agent) { //returns vision data for prompting
    //vision prompt
    let res = '';
    return res;
}

async function memQuery(prompt) { //returns relevant memories to current prompt
    //chroma DB querying with given query

    //query needs return a list of memories with a score
    //query needs to return saved locations around bot in memory
    // this second one is needed to prompt on structures around the bot that it might not want to destroy
    let res = '';

    return res;
}

async function memStore(agent, type, content, result, context='') {
  
}

export async function logic_test(agent) {
    try{
        queryList[3].perform(agent);
    } catch (error) {
        console.log(error);
    }
}