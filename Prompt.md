# Eagle Bot Starter Prompt

Eagle Bot is a software tool desgined with the goal to become the operating system used by any given Acton learner, assisting with everything from Town Halls to keeping track of Core Work Goals.

### The Base Problem

For simplicities sake, we will be starting with a very basic set of features, while still solving one of the most annoying problem to any learner at any Acton. The problem is as follows:

When a Studio meets to have a Governance or Town Hall meeting, the decisons and rulings are written down in order to be considerd offical, as that sort of system is signifcantly more reliable than shoty human memeory. The problem is, many Actons use mainly Google Docs for this purpose. Obviosuly, this is a very poor organization system for a variety of reasons, namely, the difficulty presented by trying figure out what is current and what isn't.

### The Solution

The flow of the thing we will be building is as follows:

- A guide or learner creates an academy and will first be asked to enter the academy's name, and an email domain for the academy (eg, @randomacton.com). The email bit becomes important later. They will also be asked to input their own email and name. The user who signs up the academy for this tool will automatically be set as an admin. They can also select a color pallet for their academy, as well as uploading a logo for their academy.

- Once the setup is complete, the admin may then upload any docs or files of any text format. The app will be wired with a Claude API key (which I already have). Once the documents are uploaded, the AI will then read the files and write an entire wiki of all the rules. It will also notify of any lacking bits or contradictions in the rules, and ask the user how to proceed. There will also be a sparate tab labeled "Positions", where a list of all the elected positons (detected by the AI) will be stored and can be altered by the Admin. 

- There will also be an admin page in which the admin can view a log of anything that occurs within the app, as well as sending invites via email using a Google App Password. The admin can then choose which role the user is to occupy: Secratry, Admin, Guide, Learner. Lastly, this admin page should posses a statuses page where the admin can see what meeting are currently in progress, what the AI is waiting on, etc.

- Another tab labeled "Town Hall" should also be made. This contains a workspace for the secratary or note-taker to denote the proceedings of the governance meeting. For the workspace, I want you to get creative and think on which features would be most usefull to a secratary. Once the note-taker is done, they can then press the "Process with AI" button, and the same AI mentioned above will read the notes and make changes to the wiki accoridngly. It will not only add the new information in the most convinent place, it will also remove any contradicting rules from anywhere. Additonally, the AI will also detect anyyhting that would hypothetically require an election and ask the user if it should create one or not.

- Thus, there will be an elections tab where an admin, or AI based on Town Hall notes can create elections visible to any hero, who can the cast their vote. If the election has anything to do with a position, the app will automatically assign the winner to that positon. If it is a rules election, the AI will be inofrmed what the verdict was an proceed to update the wiki accordingly.

- Lastly, each user should have a profile page where they can have a bio and image of themselves, as well as a summary of the positons they have occupied in the past. Some of this will be displayed under their icon during elections. 

If there is anything I haven't mentioned, that you think would go well for this project, feel free to ask me. Recall that all the features should be built with the Acton philosphy in mind.

### The basic idea for architecture

This project will be built here, and then pushed to Replit for hosting and DB using using Github.